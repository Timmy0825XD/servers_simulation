"""
Simulación de eventos discretos (DES) de un clúster de servidores.

Sigue las ecuaciones y reglas del informe:
  λ = 1 / MTBF
  μ = 1 / MTTR
  ν = 1 / T_prev
  A_individual = MTBF / (MTBF + MTTR)
  Weibull (envejecimiento, β > 1):
      f(t) = (β / η) · (t / η)^(β-1) · e^(-(t / η)^β)

Políticas:
  - correctiva: solo se interviene tras la falla
  - preventiva: paradas periódicas que compiten por técnicos
    (la correctiva tiene mayor prioridad)
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import Enum
from typing import Any

import numpy as np
import simpy


class Policy(str, Enum):
    CORRECTIVE = "correctiva"
    PREVENTIVE = "preventiva"


# Prioridad SimPy: menor número = más urgente
PRIO_CORRECTIVE = 0
PRIO_PREVENTIVE = 1

STATE_O = 0  # Operativo
STATE_F = 1  # En Falla
STATE_M = 2  # En Mantenimiento


@dataclass
class ClusterParams:
    n_total: int = 10
    n_required: int = 8
    n_technicians: int = 2
    mtbf: float = 2000.0
    mttr: float = 8.0
    t_prev: float = 720.0
    beta: float = 1.8
    eta: float | None = None
    horizon: float = 8760.0
    replications: int = 1000
    seed: int = 42
    cost_corrective: float = 450.0
    cost_preventive: float = 120.0
    cost_sla_hour: float = 2500.0
    sla: float = 0.999
    use_weibull: bool = True

    def __post_init__(self) -> None:
        if self.eta is None:
            # Escala Weibull anclada al MTBF de catálogo
            self.eta = float(self.mtbf)
        if self.n_required > self.n_total:
            raise ValueError("n_required no puede superar n_total")
        if self.n_technicians < 1:
            raise ValueError("se requiere al menos un técnico")

    @property
    def k_redundant(self) -> int:
        return self.n_total - self.n_required

    @property
    def lambda_fail(self) -> float:
        return 1.0 / self.mtbf

    @property
    def mu_repair(self) -> float:
        return 1.0 / self.mttr

    @property
    def nu_prev(self) -> float:
        return 1.0 / self.t_prev

    @property
    def a_individual(self) -> float:
        return self.mtbf / (self.mtbf + self.mttr)


class _Rng:
    def __init__(self, seed: int) -> None:
        self._rng = np.random.default_rng(seed)

    def time_to_failure(self, params: ClusterParams) -> float:
        if params.use_weibull:
            # NumPy Weibull(β) tiene escala 1; T = η · W
            return float(params.eta * self._rng.weibull(params.beta))
        return float(self._rng.exponential(params.mtbf))

    def repair_time(self, params: ClusterParams) -> float:
        return float(self._rng.exponential(params.mttr))

    def preventive_time(self, params: ClusterParams) -> float:
        # Intervención preventiva más corta que una reparación de falla
        return float(self._rng.exponential(max(1.0, params.mttr * 0.45)))


class ClusterModel:
    def __init__(self, env: simpy.Environment, params: ClusterParams, policy: Policy, rng: _Rng) -> None:
        self.env = env
        self.params = params
        self.policy = policy
        self.rng = rng
        self.techs = simpy.PriorityResource(env, capacity=params.n_technicians)
        self.states = [STATE_O] * params.n_total
        self.last_t = 0.0
        self.service_up_time = 0.0
        self.n_failures = 0
        self.n_repairs = 0
        self.n_preventive = 0
        self.tech_busy_time = 0.0
        self.queue_integral = 0.0
        self.last_queue_t = 0.0
        self.last_queue_len = 0

    def operational_count(self) -> int:
        return sum(1 for s in self.states if s == STATE_O)

    def cluster_up(self) -> bool:
        return self.operational_count() >= self.params.n_required

    def _flush_availability(self) -> None:
        now = self.env.now
        dt = now - self.last_t
        if dt > 0 and self.cluster_up():
            self.service_up_time += dt
        self.last_t = now

    def set_state(self, idx: int, state: int) -> None:
        self._flush_availability()
        self.states[idx] = state

    def _flush_queue(self) -> None:
        now = self.env.now
        dt = now - self.last_queue_t
        if dt > 0:
            self.queue_integral += self.last_queue_len * dt
        self.last_queue_t = now
        self.last_queue_len = len(self.techs.queue)

    def server_process(self, idx: int):
        while True:
            ttf = self.rng.time_to_failure(self.params)
            if self.policy == Policy.PREVENTIVE:
                ttf = min(ttf, self.params.t_prev)

            yield self.env.timeout(ttf)

            if self.policy == Policy.PREVENTIVE and ttf >= self.params.t_prev - 1e-9:
                yield from self._preventive(idx)
            else:
                yield from self._corrective(idx)

    def _corrective(self, idx: int):
        self.n_failures += 1
        self.set_state(idx, STATE_F)
        self._flush_queue()
        with self.techs.request(priority=PRIO_CORRECTIVE) as req:
            yield req
            self._flush_queue()
            start = self.env.now
            yield self.env.timeout(self.rng.repair_time(self.params))
            self.tech_busy_time += self.env.now - start
            self.n_repairs += 1
        self.set_state(idx, STATE_O)

    def _preventive(self, idx: int):
        self.set_state(idx, STATE_M)
        self._flush_queue()
        with self.techs.request(priority=PRIO_PREVENTIVE) as req:
            yield req
            self._flush_queue()
            start = self.env.now
            yield self.env.timeout(self.rng.preventive_time(self.params))
            self.tech_busy_time += self.env.now - start
            self.n_preventive += 1
        self.set_state(idx, STATE_O)

    def finalize(self) -> dict[str, float]:
        self._flush_availability()
        self._flush_queue()
        horizon = max(self.env.now, self.params.horizon)
        a_obs = self.service_up_time / horizon if horizon else 0.0
        sla_hours = max(0.0, horizon - self.service_up_time)
        cost = (
            self.n_repairs * self.params.cost_corrective
            + self.n_preventive * self.params.cost_preventive
            + sla_hours * self.params.cost_sla_hour
        )
        tech_hours = horizon * self.params.n_technicians
        return {
            "availability": a_obs,
            "sla_ok": float(a_obs >= self.params.sla),
            "downtime_hours": sla_hours,
            "failures": float(self.n_failures),
            "repairs": float(self.n_repairs),
            "preventive": float(self.n_preventive),
            "tech_utilization": self.tech_busy_time / tech_hours if tech_hours else 0.0,
            "avg_queue": self.queue_integral / horizon if horizon else 0.0,
            "cost": cost,
        }


def _run_once(params: ClusterParams, policy: Policy, seed: int) -> dict[str, float]:
    env = simpy.Environment()
    rng = _Rng(seed)
    model = ClusterModel(env, params, policy, rng)
    for i in range(params.n_total):
        env.process(model.server_process(i))
    env.run(until=params.horizon)
    return model.finalize()


def simulate_scenario(params: ClusterParams, policy: Policy) -> dict[str, Any]:
    reps = max(1, int(params.replications))
    rows = [_run_once(params, policy, params.seed + r) for r in range(reps)]
    keys = [
        "availability",
        "sla_ok",
        "downtime_hours",
        "failures",
        "repairs",
        "preventive",
        "tech_utilization",
        "avg_queue",
        "cost",
    ]
    means = {k: float(np.mean([row[k] for row in rows])) for k in keys}
    stds = {k: float(np.std([row[k] for row in rows], ddof=1)) if reps > 1 else 0.0 for k in keys}
    avail = np.array([row["availability"] for row in rows], dtype=float)
    return {
        "policy": policy.value,
        "replications": reps,
        "means": means,
        "stds": stds,
        "availability_series": [round(float(x), 6) for x in avail.tolist()],
        "converged": bool(reps > 1 and stds["availability"] < 0.001),
        "sigma_A": stds["availability"],
    }


def compare_policies(params: ClusterParams) -> dict[str, Any]:
    corrective = simulate_scenario(params, Policy.CORRECTIVE)
    preventive = simulate_scenario(params, Policy.PREVENTIVE)
    winner = (
        "preventiva"
        if preventive["means"]["availability"] > corrective["means"]["availability"]
        else "correctiva"
    )
    return {
        "params": {
            **asdict(params),
            "k_redundant": params.k_redundant,
            "lambda": params.lambda_fail,
            "mu": params.mu_repair,
            "nu": params.nu_prev,
            "A_individual": params.a_individual,
        },
        "equations": {
            "lambda": "λ = 1 / MTBF",
            "mu": "μ = 1 / MTTR",
            "nu": "ν = 1 / T_prev",
            "A_individual": "A = MTBF / (MTBF + MTTR)",
            "weibull": "f(t) = (β/η)·(t/η)^(β-1)·e^(-(t/η)^β)",
            "cluster": "A_cluster = P(servidores operativos ≥ N)",
        },
        "correctiva": corrective,
        "preventiva": preventive,
        "winner": winner,
        "delta_availability": preventive["means"]["availability"] - corrective["means"]["availability"],
        "delta_cost": corrective["means"]["cost"] - preventive["means"]["cost"],
    }
