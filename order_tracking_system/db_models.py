import datetime
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

Base = declarative_base()

class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False)
    email = Column(String, unique=True, nullable=False)
    # Add other user-related fields as needed
    orders = relationship('Order', back_populates='user')

class Order(Base):
    __tablename__ = 'orders'
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    order_date = Column(DateTime, default=datetime.datetime.utcnow)
    # Add other order-related fields as needed
    user = relationship('User', back_populates='orders')
    tracking_events = relationship('TrackingEvent', back_populates='order')

class TrackingEvent(Base):
    __tablename__ = 'tracking_events'
    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey('orders.id'), nullable=False)
    event_type = Column(Enum('Order Placed', 'Shipped', 'In Transit', 'Out for Delivery', 'Delivered', name='event_types'), nullable=False)
    event_timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    location = Column(String)
    # Add other tracking-related fields as needed
    order = relationship('Order', back_populates='tracking_events')

# Example usage (replace with your database URL)
db_url = 'sqlite:///./order_tracking.db'
engine = create_engine(db_url)
Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)
session = Session()