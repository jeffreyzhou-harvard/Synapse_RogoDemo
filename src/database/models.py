from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.ext.declarative import declarative_base
import enum

Base = declarative_base()

class UserStatus(enum.Enum):
    ACTIVE = 1
    INACTIVE = 0

class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False, index=True)
    phone_number = Column(String, unique=True, nullable=False)
    status = Column(Enum(UserStatus), default=UserStatus.ACTIVE)
    orders = relationship('Order', back_populates='user')

class OrderStatus(enum.Enum):
    REQUESTED = 1
    ACCEPTED = 2
    ONGOING = 3
    COMPLETED = 4
    CANCELLED = 5

class Order(Base):
    __tablename__ = 'orders'
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    status = Column(Enum(OrderStatus), default=OrderStatus.REQUESTED)
    pickup_location = Column(String, nullable=False)
    dropoff_location = Column(String, nullable=False)
    request_time = Column(DateTime, nullable=False)
    user = relationship('User', back_populates='orders')
    tracking_events = relationship('TrackingEvent', back_populates='order')

class TrackingEventType(enum.Enum):
    REQUESTED = 1
    ACCEPTED = 2
    PICKED_UP = 3
    ARRIVED = 4
    COMPLETED = 5
    CANCELLED = 6

class TrackingEvent(Base):
    __tablename__ = 'tracking_events'
    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey('orders.id'), nullable=False)
    event_type = Column(Enum(TrackingEventType), nullable=False)
    timestamp = Column(DateTime, nullable=False)
    location = Column(String)
    details = Column(String)
    order = relationship('Order', back_populates='tracking_events')
