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
def get_google_auth_url(redirect_to: str = None):
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
def test_google_auth_traceback(redirect_to: str = None):
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
def get_bench_logs(filename: str = None):
    import os
    logs_dir = "/home/frappe/frappe-bench/logs"
    if not os.path.exists(logs_dir):
        return f"Logs directory not found at {logs_dir}"
    
    if not filename:
        return {
            "files": os.listdir(logs_dir),
            "site_logs": os.listdir("/home/frappe/frappe-bench/sites/lms.render/logs") if os.path.exists("/home/frappe/frappe-bench/sites/lms.render/logs") else []
        }
    
    filepath = os.path.join(logs_dir, filename)
    if not os.path.exists(filepath):
        filepath = os.path.join("/home/frappe/frappe-bench/sites/lms.render/logs", filename)
        if not os.path.exists(filepath):
            return f"File {filename} not found"
            
    with open(filepath, 'r') as f:
        lines = f.readlines()
        return "".join(lines[-200:])

@frappe.whitelist(allow_guest=True)
def get_api_file():
    with open(__file__, 'r') as f:
        return f.read()

@frappe.whitelist(allow_guest=True)
def test_login_via_google(code: str = None, state: str = None, **kwargs):
    import traceback
    try:
        from frappe.integrations.oauth2_logins import login_via_google
        return login_via_google(code, state)
    except Exception as e:
        return {
            "error": str(e),
            "traceback": traceback.format_exc()
        }

@frappe.whitelist(allow_guest=True)
def get_environ_debug():
    import os
    client_id = os.environ.get("GOOGLE_CLIENT_ID") or ""
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET") or ""
    return {
        "client_id": client_id,
        "client_secret_len": len(client_secret),
        "client_secret_start": client_secret[:10],
        "client_secret_end": client_secret[-4:] if client_secret else ""
    }

@frappe.whitelist(allow_guest=True)
def read_any_file(path: str, start: int = 1, end: int = 100):
    try:
        with open(path, 'r') as f:
            lines = f.readlines()
            return "".join(lines[start-1:end])
    except Exception as e:
        return str(e)

# Monkey patch login_via_google to catch errors and redirect gracefully to the frontend login page
try:
    import frappe.integrations.oauth2_logins
    orig_login_via_google = frappe.integrations.oauth2_logins.login_via_google

    def patched_login_via_google(code: str, state: str, **kwargs):
        import frappe
        try:
            return orig_login_via_google(code, state, **kwargs)
        except Exception as e:
            import traceback
            frappe.log_error(title="Google Login Failed", message=traceback.format_exc())
            frappe.db.commit()
            
            # Determine redirect destination
            import base64
            import json
            from urllib.parse import urlparse
            frontend_url = "https://vyomanta.vercel.app"
            try:
                state_data = json.loads(base64.b64decode(state).decode("utf-8"))
                redirect_to = state_data.get("redirect_to")
                if redirect_to:
                    parsed = urlparse(redirect_to)
                    frontend_url = f"{parsed.scheme}://{parsed.netloc}"
            except Exception:
                pass
            
            frappe.local.response["type"] = "redirect"
            frappe.local.response["location"] = f"{frontend_url}/login?error=oauth_failed"

    # Retain the whitelist flag
    patched_login_via_google.whitelisted = True
    patched_login_via_google.allow_guest = True
    
    frappe.integrations.oauth2_logins.login_via_google = patched_login_via_google
except Exception as patch_err:
    import frappe
    frappe.log_error(title="Monkey Patch Failed", message=str(patch_err))
"""

    with open(api_path, 'w') as f:
        f.write(content.strip() + patch_code)
    print("✅ Patched apps/lms/lms/lms/api.py successfully with get_api_file!")

if __name__ == '__main__':
    main()
