from routes import tickets
from fastapi import FastAPI


app = FastAPI()

@app.get("/health")
def health_check():
    return {"status": "ok"}

app.include_router(tickets.router)