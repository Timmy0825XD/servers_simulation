from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from simulation.cluster import ClusterParams, compare_policies

ROOT = Path(__file__).parent
WEB = ROOT / "web"

app = FastAPI(title="Cluster DES Lab", version="1.0.0")
app.mount("/static", StaticFiles(directory=WEB), name="static")


class SimRequest(BaseModel):
    n_total: int = Field(10, ge=2, le=40)
    n_required: int = Field(8, ge=1, le=40)
    n_technicians: int = Field(2, ge=1, le=20)
    mtbf: float = Field(2000, gt=1, le=50000)
    mttr: float = Field(8, gt=0.1, le=500)
    t_prev: float = Field(720, gt=1, le=8760)
    beta: float = Field(1.8, gt=0.5, le=6)
    replications: int = Field(40, ge=1, le=200)
    use_weibull: bool = True


@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB / "index.html")


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "engine": "simpy", "horizon_h": 8760}


@app.post("/api/simulate")
def run_simulation(body: SimRequest) -> dict:
    if body.n_required > body.n_total:
        raise HTTPException(400, "N requerido no puede ser mayor que N total")
    params = ClusterParams(
        n_total=body.n_total,
        n_required=body.n_required,
        n_technicians=body.n_technicians,
        mtbf=body.mtbf,
        mttr=body.mttr,
        t_prev=body.t_prev,
        beta=body.beta,
        replications=body.replications,
        use_weibull=body.use_weibull,
    )
    return compare_policies(params)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=5173, reload=True)
