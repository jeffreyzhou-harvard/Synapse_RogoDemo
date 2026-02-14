# calculator.py

"""A simple calculator class for basic arithmetic operations.
"""

class Calculator:
    """Performs basic arithmetic operations.
    """

    def add(self, x, y):
        """Adds two numbers.

        Args:
            x: The first number.
            y: The second number.

        Returns:
            The sum of x and y.

        Raises:
            TypeError: If either input is not a number.
        """
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            raise TypeError("Both inputs must be numbers.")
        return x + y

    def subtract(self, x, y):
        """Subtracts two numbers.

        Args:
            x: The first number.
            y: The second number.

        Returns:
            The difference between x and y.

        Raises:
            TypeError: If either input is not a number.
        """
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            raise TypeError("Both inputs must be numbers.")
        return x - y

    def multiply(self, x, y):
        """Multiplies two numbers.

        Args:
            x: The first number.
            y: The second number.

        Returns:
            The product of x and y.

        Raises:
            TypeError: If either input is not a number.
        """
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            raise TypeError("Both inputs must be numbers.")
        return x * y

    def divide(self, x, y):
        """Divides two numbers.

        Args:
            x: The first number.
            y: The second number.

        Returns:
            The quotient of x and y.

        Raises:
            TypeError: If either input is not a number.
            ZeroDivisionError: If y is zero.
        """
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            raise TypeError("Both inputs must be numbers.")
        if y == 0:
            raise ZeroDivisionError("Cannot divide by zero.")
        return x / y

# Example usage
calculator = Calculator()

print(calculator.add(5, 3))  # Output: 8
print(calculator.subtract(10, 4))  # Output: 6
print(calculator.multiply(7, 2))  # Output: 14
print(calculator.divide(9, 3))  # Output: 3.0

#Error Handling example
#print(calculator.divide(5,0)) #Raises ZeroDivisionError
#print(calculator.add(5,"a")) #Raises TypeError