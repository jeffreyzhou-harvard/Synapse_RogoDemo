from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel
import jwt
import bcrypt
import redis
from datetime import datetime, timedelta

app = FastAPI()

# Authentication models
class UserLogin(BaseModel):
    email: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

# JWT Configuration
SECRET_KEY = "your-secret-key"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# Redis for session storage
redis_client = redis.Redis(host='localhost', port=6379, db=0)

@app.post("/auth/login", response_model=Token)
async def login(user_data: UserLogin):
    """Authenticate user and return JWT token"""
    # Verify password with bcrypt
    if not bcrypt.checkpw(user_data.password.encode(), stored_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    # Create JWT token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user_data.email}, expires_delta=access_token_expires
    )
    
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/auth/refresh")
async def refresh_token():
    """Refresh JWT token"""
    pass

def create_access_token(data: dict, expires_delta: timedelta = None):
    """Create JWT access token"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt
