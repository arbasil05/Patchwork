import os
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

MONGODB_URI = os.getenv("MONGODB")

client = MongoClient(MONGODB_URI)

db = client["Patchwork"]
