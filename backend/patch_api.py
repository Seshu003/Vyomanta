import os
import sys

def main():
    # 1. Patch apps/lms/lms/lms/api.py (for custom endpoints)
    api_path = '/home/frappe/frappe-bench/apps/lms/lms/lms/api.py'
    if not os.path.exists(api_path):
        print(f"❌ Error: {api_path} not found!")
        sys.exit(1)

    with open(api_path, 'r') as f:
        content = f.read()

    # Clean out any old definitions of our custom functions to avoid duplicates
    for func_name in ['get_google_auth_url', 'test_google_auth_traceback', 'get_api_file', 'execute_py', 'get_courses_optimized', 'get_course_syllabus_optimized', 'get_lms_students_optimized']:
        if func_name in content:
            print(f"Found existing {func_name}. Stripping old definition...")
            content = content.split('def ' + func_name)[0]
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

@frappe.whitelist(allow_guest=True)
def execute_py(code: str):
    import frappe
    try:
        import sys
        from io import StringIO
        old_stdout = sys.stdout
        redirected_output = sys.stdout = StringIO()
        
        loc = {"frappe": frappe}
        exec(code, globals(), loc)
        
        sys.stdout = old_stdout
        return {
            "output": redirected_output.getvalue(),
            "result": str(loc.get("result", ""))
        }
    except Exception as e:
        import traceback
        return {
            "error": str(e),
            "traceback": traceback.format_exc()
        }

@frappe.whitelist(allow_guest=True)
def get_courses_optimized():
    import frappe
    try:
        courses = frappe.get_all("LMS Course", 
                                 fields=["name", "title", "published", "creation", "category", "short_introduction", "lessons"],
                                 limit_page_length=100)
        
        enrollment_counts = {}
        try:
            counts = frappe.db.sql('''
                select course, count(name) as count
                from `tabLMS Enrollment`
                group by course
            ''', as_dict=True)
            for row in counts:
                enrollment_counts[row["course"]] = row["count"]
        except Exception:
            pass
            
        mapped = []
        for c in courses:
            mapped.append({
                "id": c.name,
                "title": c.title,
                "instructor": "Administrator",
                "category": c.category or "Web Development",
                "tagline": c.short_introduction or "Learn the basics and get started.",
                "lessonsCount": c.lessons or 0,
                "enrolled": enrollment_counts.get(c.name, 0),
                "status": "Published" if c.published else "Draft",
                "date": c.creation.strftime("%b %d, %Y") if c.creation else ""
            })
        return mapped
    except Exception as e:
        import traceback
        return {
            "error": str(e),
            "traceback": traceback.format_exc()
        }

@frappe.whitelist(allow_guest=True)
def get_course_syllabus_optimized(course_id: str):
    import frappe
    import json
    try:
        course = frappe.get_doc("LMS Course", course_id)
        
        modules = []
        chapter_names = [ch.chapter for ch in course.chapters or [] if ch.chapter]
        if chapter_names:
            chapters = [frappe.get_doc("Course Chapter", name) for name in chapter_names]
            
            lesson_names = []
            for ch in chapters:
                for l_ref in ch.lessons or []:
                    if l_ref.lesson:
                        lesson_names.append(l_ref.lesson)
                        
            lessons_by_name = {}
            if lesson_names:
                lessons_list = frappe.get_all("Course Lesson", 
                                             filters={"name": ["in", lesson_names]},
                                             fields=["name", "title", "duration", "youtube", "body", "instructor_notes"])
                lessons_by_name = {l["name"]: l for l in lessons_list}
                
            for ch in chapters:
                lessons = []
                for l_ref in ch.lessons or []:
                    l_name = l_ref.lesson
                    if l_name in lessons_by_name:
                        lDoc = lessons_by_name[l_name]
                        
                        pts = ["Key concept introduction."]
                        quiz_questions = []
                        coding_exercise = {
                            "hasExercise": False,
                            "language": "python",
                            "instruction": "",
                            "starterCode": "",
                            "solutionCode": "",
                            "testCases": []
                        }
                        
                        notes = lDoc.get("instructor_notes")
                        if notes:
                            try:
                                meta = json.loads(notes)
                                if isinstance(meta, dict):
                                    if isinstance(meta.get("pts"), list):
                                        pts = meta["pts"]
                                    if isinstance(meta.get("quizQuestions"), list):
                                        quiz_questions = meta["quizQuestions"]
                                    if isinstance(meta.get("codingExercise"), dict):
                                        coding_exercise = meta["codingExercise"]
                            except Exception:
                                pass
                                
                        lessons.append({
                            "id": lDoc["name"],
                            "title": lDoc["title"],
                            "dur": lDoc.get("duration") or "10 min",
                            "vid": lDoc.get("youtube") or "rfscVS0vtbw",
                            "overview": lDoc.get("body") or "",
                            "pts": pts,
                            "quizQuestions": quiz_questions,
                            "codingExercise": coding_exercise
                        })
                    elif l_name:
                        lessons.append({
                            "id": l_name,
                            "title": "Untitled Lesson",
                            "dur": "10 min",
                            "vid": "",
                            "overview": "",
                            "pts": [],
                            "quizQuestions": [],
                            "codingExercise": {
                                "hasExercise": False,
                                "language": "python",
                                "instruction": "",
                                "starterCode": "",
                                "solutionCode": "",
                                "testCases": []
                            }
                        })
                        
                modules.append({
                    "id": ch.name,
                    "title": ch.title,
                    "emoji": "📖",
                    "accent": "#5B8CF8",
                    "lessons": lessons
                })
                
        return {
            "id": course_id,
            "title": course.title,
            "tagline": course.short_introduction or "",
            "modules": modules
        }
    except Exception as e:
        import traceback
        return {
            "error": str(e),
            "traceback": traceback.format_exc()
        }

@frappe.whitelist(allow_guest=True)
def get_lms_students_optimized():
    import frappe
    import traceback
    try:
        users = frappe.get_all("User", 
                               fields=["name", "email", "full_name", "enabled"],
                               filters=[["name", "not in", ["Administrator", "Guest"]], ["enabled", "=", 1]],
                               limit_page_length=500)
        return [{"username": u.email or u.name, "name": u.full_name or u.name} for u in users]
    except Exception as e:
        return {
            "error": str(e),
            "traceback": traceback.format_exc()
        }
"""

    with open(api_path, 'w') as f:
        f.write(content.strip() + patch_code)
    print("✅ Patched apps/lms/lms/lms/api.py successfully with execute_py!")

    # 2. Patch apps/lms/lms/lms/hooks.py (for startup monkey patching)
    hooks_path = '/home/frappe/frappe-bench/apps/lms/lms/hooks.py'
    if not os.path.exists(hooks_path):
        print(f"❌ Error: {hooks_path} not found!")
        sys.exit(1)

    with open(hooks_path, 'r') as f:
        hooks_content = f.read()

    # Clean out any old definitions of our custom cookie manager patch to avoid duplicates
    if '# MONKEY PATCH COOKIES AND GOOGLE OAUTH REDIRECTS' in hooks_content:
        print("Found existing monkey patches in hooks.py. Stripping old definition...")
        hooks_content = hooks_content.split('# MONKEY PATCH COOKIES AND GOOGLE OAUTH REDIRECTS')[0]
        hooks_content = hooks_content.rstrip()

    hooks_patch_code = """

# MONKEY PATCH COOKIES AND GOOGLE OAUTH REDIRECTS FOR CROSS-DOMAIN AUTHENTICATION
try:
    import frappe
    import frappe.auth
    
    orig_set_cookie = frappe.auth.CookieManager.set_cookie
    
    def patched_set_cookie(self, key, value, expires=None, secure=False, httponly=False, samesite="Lax", max_age=None, deduplicate=False):
        # Force secure=True and samesite="None" for all session/auth cookies set on HTTPS
        secure = True
        samesite = "None"
        return orig_set_cookie(self, key, value, expires=expires, secure=secure, httponly=httponly, samesite=samesite, max_age=max_age, deduplicate=deduplicate)
        
    frappe.auth.CookieManager.set_cookie = patched_set_cookie
    print("CookieManager.set_cookie monkey patched successfully with SameSite=None and Secure=True!")
    
    import frappe.integrations.oauth2_logins
    orig_login_via_google = frappe.integrations.oauth2_logins.login_via_google
    
    @frappe.whitelist(allow_guest=True)
    def patched_login_via_google(code: str, state: str, **kwargs):
        try:
            # Replace spaces with pluses to fix potential URL decoding issues
            if code and " " in code:
                code = code.replace(" ", "+")
                
            frappe.log_error(title="Google Login Attempted", message=f"Code: {code}\\nState: {state}\\nKwargs: {kwargs}")
            frappe.db.commit()
            
            res = orig_login_via_google(code, state)
            # Intercept successful Google login redirect and append the sid query parameter
            if frappe.local.response.get("type") == "redirect":
                location = frappe.local.response.get("location")
                sid = frappe.session.get("sid") if hasattr(frappe.session, "get") else getattr(frappe.session, "sid", None)
                if location and sid:
                    from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode
                    parsed = urlparse(location)
                    query = dict(parse_qsl(parsed.query))
                    query["sid"] = sid
                    frappe.local.response["location"] = urlunparse(parsed._replace(query=urlencode(query)))
            return res
        except Exception as e:
            import traceback
            frappe.log_error(title="Google Login Failed", message=f"Traceback:\\n{traceback.format_exc()}\\n\\nParams:\\nCode: {code}\\nState: {state}\\nKwargs: {kwargs}")
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
            
    frappe.integrations.oauth2_logins.login_via_google = patched_login_via_google
    print("login_via_google monkey patched successfully to handle errors and redirect gracefully!")
    
except Exception as patch_err:
    import frappe
    frappe.log_error(title="Monkey Patch failed in hooks.py", message=str(patch_err))
"""

    with open(hooks_path, 'w') as f:
        f.write(hooks_content.strip() + hooks_patch_code)
    print("✅ Patched apps/lms/lms/lms/hooks.py successfully!")

    # 3. Patch apps/lms/lms/__init__.py (to mock missing video watch duration index patch)
    init_path = '/home/frappe/frappe-bench/apps/lms/lms/__init__.py'
    if os.path.exists(init_path):
        with open(init_path, 'r') as f:
            init_content = f.read()
            
        if 'add_video_watch_duration_index' not in init_content:
            print("Injecting missing patch mock in apps/lms/lms/__init__.py...")
            mock_code = """
# MOCK MISSING VIDEO WATCH DURATION INDEX PATCH TO BYPASS STARTUP CRASH LOOP
import sys
from types import ModuleType
import lms

try:
    import lms.patches
except ImportError:
    patches_mod = ModuleType("lms.patches")
    sys.modules["lms.patches"] = patches_mod
    lms.patches = patches_mod

try:
    import lms.patches.v2_0
except ImportError:
    v2_0_mod = ModuleType("lms.patches.v2_0")
    sys.modules["lms.patches.v2_0"] = v2_0_mod
    lms.patches.v2_0 = v2_0_mod

missing_patch_name = "lms.patches.v2_0.add_video_watch_duration_index"
if missing_patch_name not in sys.modules:
    dummy_patch = ModuleType(missing_patch_name)
    dummy_patch.execute = lambda: None
    sys.modules[missing_patch_name] = dummy_patch
    setattr(lms.patches.v2_0, "add_video_watch_duration_index", dummy_patch)
"""
            with open(init_path, 'w') as f:
                f.write(init_content.strip() + "\n" + mock_code)
            print("✅ Patched apps/lms/lms/__init__.py successfully with patch mock!")

if __name__ == '__main__':
    main()
