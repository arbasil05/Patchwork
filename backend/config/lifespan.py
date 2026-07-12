from config.mongo_db import client
from contextlib import asynccontextmanager
from fastapi import FastAPI
from config.sql_db import engine, Base
import models.user_model  # Ensure models are loaded

@asynccontextmanager
async def lifespan(app:FastAPI):

    print("Connecting to MongoDB Atlas...")

    try:
        client.admin.command('ping')
        print("Successfully connected to mongodb Atlas")
    except Exception as e:
        print(f"Failed to connect to MongoDB: {e}")
        
    print("Initializing SQLite tables...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("SQLite tables initialized")
    
    yield

    print("Closing MongoDB connection...")
    client.close()
    print("MongoDB connection closed")