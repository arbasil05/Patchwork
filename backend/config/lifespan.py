from config.mongo_db import client
from contextlib import asynccontextmanager
from fastapi import FastAPI


@asynccontextmanager
async def lifespan(app:FastAPI):

    print("Connecting to MongoDB Atlas...")

    try:
        client.admin.command('ping')
        print("Successfully connected to mongodb Atlas")
    except Exception as e:
        print(f"Failed to connect to MongoDB: {e}")
    
    yield

    print("Closing MongoDB connection...")
    client.close()
    print("MongoDB connection closed")