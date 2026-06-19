import os
import sys

def main():
    api_path = '/home/frappe/frappe-bench/apps/lms/lms/lms/api.py'
    if not os.path.exists(api_path):
        print(f"❌ Error: {api_path} not found!")
        sys.exit(1)

    with open(api_path, 'r') as f:
        content = f.read()

    if 'get_google_auth_url' in content:
        print("get_google_auth_url already exists in api.py. Skipping patch.")
        return

    patch_code = """

@frappe.whitelist(allow_guest=True)
def get_google_auth_url(redirect_to=None):
    import frappe
    import traceback
    try:
        from frappe.utils.oauth import get_oauth2_authorize_url
        return get_oauth2_authorize_url("google", redirect_to)
    except Exception as e:
        return {
            "error": str(e),
            "traceback": traceback.format_exc()
        }
"""

    with open(api_path, 'a') as f:
        f.write(patch_code)
    print("✅ Patched apps/lms/lms/lms/api.py successfully!")

if __name__ == '__main__':
    main()
