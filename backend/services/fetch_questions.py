from typing import Optional
from pydantic import BaseModel
from config.mongo_db import db  

class ChallengeModel(BaseModel):
    title: str
    description: str
    editable_files: list[str]
    files: dict[str, str]

class AllChallenge(BaseModel):
    question_id : int
    title : str
    framework : str
    description : str

class ChallengeList(BaseModel):
    challenges : list[AllChallenge]
    

async def get_challenge(framework: str, challenge_id: int) -> Optional[ChallengeModel]:
    """
    Fetches the challenge document from MongoDB Atlas.
    Dynamically uses the framework name ('django' or 'express') as the collection.
    """
    try:
        collection = db[framework.lower()]
        document = collection.find_one({"question_id": challenge_id})

        if not document:
            print(f"[MongoService] Challenge {challenge_id} not found in collection '{framework}'")
            return None

        files_dict = {}
        for f in document.get("files", []):
            file_name = f.get("filename")
            content = f.get("content", "")
            if file_name:
                files_dict[file_name] = content

        editable_files = document.get("editable_files", list(files_dict.keys()))

        return ChallengeModel(
            title=document.get("title", ""),
            description=document.get("description", ""),
            editable_files=editable_files,
            files=files_dict
        )

    except Exception as e:
        print(f"[MongoService] Error fetching challenge {challenge_id} from MongoDB: {e}")
        return None
    
async def get_challenges(framework: str) -> Optional[ChallengeList]:
    try:
        collection = db[framework.lower()]
        
        # .find({}) returns a cursor. We will iterate over it to extract the documents.
        documents = collection.find({})
        
        challenge_items = []
        for doc in documents:
            # Safely extract the fields
            question_id = doc.get("question_id")
            
            # Ensure the document actually has a question_id before adding it
            if question_id is not None:
                challenge = AllChallenge(
                    question_id=question_id,
                    title=doc.get("title", "Untitled"), 
                    framework=framework.lower(),
                    description=doc.get("description", "")
                )
                challenge_items.append(challenge)
        
        # If the list is empty after the loop, no valid documents were found
        if not challenge_items:
            print(f"[MongoService] Challenges not found in collection '{framework}'")
            return None
            
        # Return the final ChallengeList model
        return ChallengeList(challenges=challenge_items)
        
    except Exception as e:
        print(f"[MongoService] Error fetching challenges for {framework}: {e}")
        return None