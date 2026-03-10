import json, os, time, re
from pathlib import Path

import requests

PROJECT_ROOT = Path('/Users/czarflix/Downloads/DSA/dsa-app')
ENV_FILES = [PROJECT_ROOT / '.env.local', PROJECT_ROOT / '.env']
RUNNER = None
USER = 'AYAAN'
MANUAL_27 = {117,133,138,142,146,155,208,211,235,271,285,295,297,355,372,430,449,460,652,703,715,716,731,911,981,1244,2013}
UA = {'User-Agent': 'Mozilla/5.0'}
COMMON_PREFIX = '''from typing import *\nfrom collections import *\nfrom functools import *\nfrom itertools import *\nfrom heapq import *\nimport bisect\nimport collections\nimport functools\nimport heapq\nimport itertools\nimport math\nimport operator\ninf = float("inf")\ncache = getattr(functools, "cache", functools.lru_cache(maxsize=None))\nlru_cache = functools.lru_cache\nsqrt = math.sqrt\nceil = math.ceil\nfloor = math.floor\nhypot = math.hypot\nxor = operator.xor\nbisect_left = bisect.bisect_left\nbisect_right = bisect.bisect_right\nif not hasattr(operator, "div"):\n    def _compat_div(a, b):\n        return int(operator.truediv(a, b))\n    operator.div = _compat_div\nif not hasattr(itertools, "pairwise"):\n    def _compat_pairwise(iterable):\n        iterator = iter(iterable)\n        try:\n            previous = next(iterator)\n        except StopIteration:\n            return\n        for current in iterator:\n            yield previous, current\n            previous = current\n    itertools.pairwise = _compat_pairwise\npairwise = itertools.pairwise\n'''
OUT = Path('/Users/czarflix/fetchinh/audit_dataset273_live_results.json')


def load_env():
    values = {}
    for path in ENV_FILES:
        if not path.exists():
            continue
        for raw in path.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            values.setdefault(key, value)
    return values


def fetch_doocs(qid, title):
    low = (qid // 100) * 100
    if qid % 100 == 0 and qid != 0:
        low -= 100
    high = low + 99
    folder = f'{low:04d}-{high:04d}'
    title_path = title.replace('/', ' ')
    for ext in ('Solution.py', 'Solution.py3'):
        url = f'https://raw.githubusercontent.com/doocs/leetcode/main/solution/{folder}/{qid:04d}.{title_path}/{ext}'
        r = requests.get(url, headers=UA, timeout=30)
        if r.status_code == 200 and r.text.strip():
            return r.text, url
    return None, None


def fetch_kamyu(slug):
    url = f'https://raw.githubusercontent.com/kamyu104/LeetCode-Solutions/master/Python/{slug}.py'
    r = requests.get(url, headers=UA, timeout=30)
    if r.status_code == 200 and r.text.strip():
        return r.text, url
    return None, None


def patch_code(qid, code):
    patched = code
    patched = patched.replace('xrange', 'range')
    patched = patched.replace('itertools.izip', 'zip')
    patched = patched.replace('.itervalues()', '.values()')
    patched = patched.replace('.iteritems()', '.items()')
    patched = patched.replace('UndirectedGraphNode', 'Node')
    patched = patched.replace('RandomListNode', 'Node')
    patched = patched.replace('.label', '.val')
    patched = re.sub(r'([A-Za-z_][A-Za-z0-9_\\.\\[\\]]*)\\s*=\\s*range\\(([^\\n\\)]*)\\)', r'\\1 = list(range(\\2))', patched)
    if qid == 716:
        patched = patched.replace('self.__max = max(self.__max, x)', 'self.__max = max(self.__max, x) if self.__max is not None else x')
    if qid == 1244:
        patched = patched.replace('scores = self.__lookup.values()', 'scores = list(self.__lookup.values())')
    if qid == 652:
        patched = patched.replace('trees.itervalues()', 'trees.values()')
    if qid in {33, 37, 153, 416}:
        patched = re.sub(r'(?<!/)/(?!/)', '//', patched)
    if qid == 338:
        patched = patched.replace('.bit_count()', '.__format__("b").count("1")')
    return patched


def create_run(problem_lc, code):
    r = requests.post(f'{RUNNER}/runs', json={'user_key': USER, 'problem_lc': problem_lc, 'code': code, 'mode': 'run'}, timeout=60)
    r.raise_for_status()
    return r.json()['id']


def poll_run(run_id):
    deadline = time.time() + 240
    while time.time() < deadline:
        r = requests.get(f'{RUNNER}/runs/{run_id}', params={'user_key': USER}, timeout=60)
        r.raise_for_status()
        data = r.json()
        if data.get('status') not in {'queued', 'running'}:
            return data
        time.sleep(1)
    raise TimeoutError(f'run {run_id} timed out')


def attempt(problem, source, raw, url):
    if not raw:
        return {'source': source, 'result': 'missing'}
    code = COMMON_PREFIX + '\n' + patch_code(problem['problem_lc'], raw).strip() + '\n'
    run_id = create_run(problem['problem_lc'], code)
    data = poll_run(run_id)
    return {
        'source': source,
        'url': url,
        'status': data.get('status'),
        'tests_passed': data.get('tests_passed'),
        'tests_total': data.get('tests_total'),
        'summary': data.get('summary'),
        'first_failed_case': data.get('first_failed_case'),
    }


def fetch_problem_rows(url, key):
    response = requests.get(
        f"{url}/rest/v1/problem_content",
        params={
            "select": "problem_lc,title,task_id,dataset_split",
            "dataset_split": "not.is.null",
            "order": "problem_lc",
        },
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
        },
        timeout=60,
    )
    response.raise_for_status()
    return response.json()


def main():
    global RUNNER
    env = load_env()
    url = env.get('VITE_SUPABASE_URL')
    key = env.get('VITE_SUPABASE_SERVICE_ROLE_KEY')
    RUNNER = env.get('VITE_RUNNER_API_URL', 'https://runner.czarflix.me').rstrip('/')
    if not url or not key:
        raise RuntimeError('Missing Supabase env vars')

    rows = fetch_problem_rows(url, key)
    problems = [row for row in rows if int(row['problem_lc']) not in MANUAL_27]

    results = []
    for idx, problem in enumerate(problems, start=1):
        qid = int(problem['problem_lc'])
        title = problem['title']
        slug = problem['task_id']
        attempts = []
        for source, raw, source_url in [
            ('doocs', *fetch_doocs(qid, title)),
            ('kamyu', *fetch_kamyu(slug)),
        ]:
            try:
                res = attempt(problem, source, raw, source_url)
            except Exception as exc:
                res = {'source': source, 'result': 'error', 'error': f'{type(exc).__name__}: {exc}'}
            attempts.append(res)
            if res.get('status') == 'passed':
                break
        record = {'problem_lc': qid, 'title': title, 'task_id': slug, 'attempts': attempts}
        results.append(record)
        print(json.dumps({'index': idx, 'of': len(problems), 'problem_lc': qid, 'attempts': attempts}, ensure_ascii=False), flush=True)
        OUT.write_text(json.dumps(results, indent=2, ensure_ascii=False))

    OUT.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f'WROTE {OUT}')

if __name__ == '__main__':
    main()
