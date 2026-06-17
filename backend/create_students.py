import frappe
from frappe.utils.password import update_password

students = [
    {"email": "student@lms.com", "name": "Student"},
    {"email": "student1@lms.com", "name": "Aarav Mehta"},
    {"email": "student2@lms.com", "name": "Sneha Patel"},
    {"email": "student3@lms.com", "name": "Rohan Sharma"},
    {"email": "student4@lms.com", "name": "Priya Nair"},
    {"email": "student5@lms.com", "name": "Aditya Rao"}
]

for s in students:
    email = s["email"]
    name = s["name"]
    
    if not frappe.db.exists("User", email):
        print(f"Creating user {email} ({name})...")
        first_name = name.split(" ")[0]
        last_name = name.split(" ")[1] if len(name.split(" ")) > 1 else ""
        user = frappe.get_doc({
            "doctype": "User",
            "email": email,
            "first_name": first_name,
            "last_name": last_name,
            "enabled": 1,
            "send_welcome_email": 0
        })
        user.insert(ignore_permissions=True)
        
        # Add LMS student role if it exists
        if frappe.db.exists("Role", "LMS Student"):
            user.add_roles("LMS Student")
    else:
        print(f"User {email} already exists.")

    # Always set/update the password to ensure it matches 'student123'
    print(f"Setting password for {email} to 'student123'...")
    update_password(user=email, pwd="student123", logout_all_sessions=False)

frappe.db.commit()
print("Students bootstrap completed successfully!")
