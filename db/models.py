import datetime
from sqlalchemy import Column, Integer, String, DateTime, Float, ForeignKey, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

Base = declarative_base()

class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    email = Column(String(255), unique=True, nullable=False)
    phone_number = Column(String(20))
    orders = relationship('Order', backref='user')

class Vehicle(Base):
    __tablename__ = 'vehicles'
    id = Column(Integer, primary_key=True)
    vehicle_id = Column(String(255), unique=True, nullable=False) # VIN or similar unique identifier
    model = Column(String(255))
    type = Column(String(255))
    battery_capacity = Column(Float)
    orders = relationship('Order', backref='vehicle')

class Order(Base):
    __tablename__ = 'orders'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    vehicle_id = Column(Integer, ForeignKey('vehicles.id'), nullable=False)
    order_date = Column(DateTime, default=datetime.datetime.utcnow)
    pickup_location = Column(String(255))
    delivery_location = Column(String(255))
    status = Column(Enum('pending', 'in_transit', 'delivered', 'cancelled'), default='pending')
    tracking_events = relationship('TrackingEvent', backref='order')

class TrackingEvent(Base):
    __tablename__ = 'tracking_events'
    id = Column(Integer, primary_key=True)
    order_id = Column(Integer, ForeignKey('orders.id'), nullable=False)
    event_timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    latitude = Column(Float)
    longitude = Column(Float)
    battery_level = Column(Float)
    charging_station_id = Column(String(255))
    status_description = Column(String(255))

#Example usage
engine = create_engine('sqlite:///./tracking.db') #Change to your preferred DB
Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)
session = Session()