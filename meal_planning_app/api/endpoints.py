from flask import Flask, request, jsonify
from flask_httpauth import HTTPBasicAuth
from werkzeug.security import generate_password_hash, check_password_hash
import json

# Initialize Flask app and HTTP authentication
app = Flask(__name__)
auth = HTTPBasicAuth()

# Sample user database (replace with a proper database in production)
users = {
    "admin": generate_password_hash("admin")
}

# Authentication endpoint
@auth.verify_password
def verify_password(username, password):
    if username in users and check_password_hash(users.get(username), password):
        return username
    return None

# Recipe management endpoints
@app.route('/recipes', methods=['GET'])
@auth.login_required
def get_recipes():
    # Replace this with actual database interaction
    recipes = [
        {"id": 1, "name": "Spaghetti", "ingredients": ["pasta", "tomato sauce"]},
        {"id": 2, "name": "Salad", "ingredients": ["lettuce", "tomatoes", "cucumber"]}
    ]
    return jsonify(recipes)

@app.route('/recipes', methods=['POST'])
@auth.login_required
def create_recipe():
    try:
        data = request.get_json()
        # Add data validation and database interaction here
        return jsonify({"message": "Recipe created successfully"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# Meal planning endpoints
@app.route('/meal_plans', methods=['GET'])
@auth.login_required
def get_meal_plans():
    # Replace this with actual database interaction
    meal_plans = [
        {"id": 1, "name": "Weekly Meal Plan", "recipes": [1, 2]}
    ]
    return jsonify(meal_plans)

@app.route('/meal_plans', methods=['POST'])
@auth.login_required
def create_meal_plan():
    try:
        data = request.get_json()
        # Add data validation and database interaction here
        return jsonify({"message": "Meal plan created successfully"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# Dietary restrictions endpoints
@app.route('/dietary_restrictions', methods=['GET'])
@auth.login_required
def get_dietary_restrictions():
    # Replace this with actual database interaction
    restrictions = [{"id": 1, "name": "Vegetarian"}, {"id": 2, "name": "Vegan"}]
    return jsonify(restrictions)

@app.route('/dietary_restrictions', methods=['POST'])
@auth.login_required
def create_dietary_restriction():
    try:
        data = request.get_json()
        # Add data validation and database interaction here
        return jsonify({"message": "Dietary restriction created successfully"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# Run the app
if __name__ == '__main__':
    app.run(debug=True)