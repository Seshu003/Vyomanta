import os
import sys

def main():
    api_path = '/home/frappe/frappe-bench/apps/lms/lms/lms/api.py'
    if not os.path.exists(api_path):
        print(f"❌ Error: {api_path} not found!")
        sys.exit(1)

    with open(api_path, 'r') as f:
        content = f.read()

    # Clean out any old definitions of our custom functions to avoid duplicates
    for func_name in ['get_google_auth_url', 'test_google_auth_traceback', 'get_api_file']:
        if func_name in content:
            print(f"Found existing {func_name}. Stripping old definition...")
            # We split by name, and take everything before it.
            # Since we append our custom code at the end, the first occurrence of our custom function
            # is where the custom code starts.
            content = content.split('def ' + func_name)[0]
            # Strip trailing decorators
            content = content.rstrip()
            if content.endswith('@frappe.whitelist(allow_guest=True)'):
                content = content[:-len('@frappe.whitelist(allow_guest=True)')]
            content = content.rstrip()

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

@frappe.whitelist(allow_guest=True)
def test_google_auth_traceback(redirect_to=None):
    import frappe
    import traceback
    try:
        from frappe.utils.oauth import get_oauth2_authorize_url
        return get_oauth2_authorize_url("google", redirect_to or "http://localhost:3000/auth/callback")
    except Exception as e:
        return {
            "error": str(e),
            "traceback": traceback.format_exc()
        }

@frappe.whitelist(allow_guest=True)
def get_api_file():
    with open(__file__, 'r') as f:
        return f.read()
"""

    with open(api_path, 'w') as f:
        f.write(content.strip() + patch_code)
    print("✅ Patched apps/lms/lms/lms/api.py successfully with get_api_file!")

if __name__ == '__main__':
    main()
