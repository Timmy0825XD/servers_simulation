# cluster_des

Presentación localhost + motor DES del examen de Modelación y Simulación (UPC).  
Informe: clúster de servidores, políticas correctiva vs preventiva, SimPy, Monte Carlo.

## Arranque

```bash
python -m venv .venv
source .venv/Scripts/activate   # Git Bash en Windows
pip install -r requirements.txt
python app.py
```

Abrir [http://127.0.0.1:5173](http://127.0.0.1:5173).

## Qué hay

- `simulation/cluster.py` — ecuaciones del PDF (`λ`, `μ`, `ν`, Weibull, A individual, cola de técnicos).
- `web/` — UI dark estilo IDE para la sustentación.
- `GUION_PRESENTACION.md` — parlamentos y reparto Josheph / Oscar.
