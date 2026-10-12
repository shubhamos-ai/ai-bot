# Friend Functions and Dynamic Memory in C++

## Friend Function
A **friend function** is not a member of a class but can access its private and protected members.

### Key Properties
- Not a member function
- Declared inside class with `friend` keyword
- Defined outside the class (like normal function)
- Can access private/protected members
- Cannot access `this` pointer

### Syntax
```cpp
class MyClass {
    int privateVar;
public:
    friend void display(MyClass obj);
};

void display(MyClass obj) {
    cout << obj.privateVar;  // Can access private
}
```

### Friend Class
```cpp
class ClassB {
public:
    void display(ClassA &a) {
        cout << a.privateVar;  // Can access ClassA's private
    }
};

class ClassA {
    int privateVar;
    friend class ClassB;  // Grant access to ClassB
};
```

### Friend Function Violates Data Hiding
- Bypasses encapsulation
- Should be used sparingly
- Useful for operator overloading and utility functions

## Dynamic Memory Allocation

### `new` Operator
- Allocates memory on the heap
- Returns a pointer to the allocated memory

```cpp
int *ptr = new int;           // Allocate single int
int *arr = new int[10];       // Allocate array of 10 ints
Student *s = new Student();   // Allocate object
```

### `delete` Operator
- Deallocates memory allocated by `new`
- Prevents memory leaks

```cpp
delete ptr;       // Free single allocation
delete[] arr;     // Free array allocation
delete s;         // Free object
```

### Dynamic Object Creation
```cpp
class Student {
    string name;
    int roll;
public:
    Student(string n, int r) : name(n), roll(r) {}
    void display() { cout << name << " " << roll << endl; }
};

int main() {
    Student *s1 = new Student("Alice", 1);
    Student *s2 = new Student("Bob", 2);

    s1->display();
    s2->display();

    delete s1;
    delete s2;
    return 0;
}
```

### Dynamic Array of Objects
```cpp
Student **students = new Student*[3];
students[0] = new Student("Alice", 1);
students[1] = new Student("Bob", 2);
students[2] = new Student("Charlie", 3);

for (int i = 0; i < 3; i++) {
    students[i]->display();
    delete students[i];
}
delete[] students;
```

## Short Answer Questions
- What is a friend function?
- What is the use of `new` and `delete` operators?
- Mention C++ operators used for dynamic memory allocation.

## Exam Questions
1. What is a friend function?
2. Explain how friend function violates the data hiding feature of C++
3. Create a class distance with member kilometer. Create a friend function to convert distance in kilometers to meters
4. Explain new and delete operators for dynamic memory allocation

---
*Source: Chapter 2 Slides, Unit 1, Exam Papers (Sept 2024, June 2025)*
