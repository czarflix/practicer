function encodePythonString(value) {
  return JSON.stringify(String(value || ''))
}

function encodeBase64(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64')
}

function buildPythonPrelude() {
  return `from __future__ import annotations
import ast
import base64
import contextlib
import io
import json
import traceback
from typing import *
from collections import *
import bisect
import functools
import heapq
import itertools
import math

if not hasattr(itertools, "pairwise"):
    def _compat_pairwise(iterable):
        iterator = iter(iterable)
        try:
            previous = next(iterator)
        except StopIteration:
            return
        for current in iterator:
            yield previous, current
            previous = current
    itertools.pairwise = _compat_pairwise

pairwise = itertools.pairwise
`
}

function buildResolveEntryBlock() {
  return `def _resolve_entry(entry_name):
    raw = str(entry_name or "").strip()
    if not raw:
        return None

    try:
        resolved = eval(raw, globals(), globals())
        if callable(resolved) or isinstance(resolved, type):
            return resolved
        if resolved is not None:
            return resolved
    except Exception:
        pass

    candidates = []
    if raw:
        candidates.append(raw)
        tail = raw.split(".")[-1].replace("()", "").strip()
        if tail and tail not in candidates:
            candidates.append(tail)

    for candidate_name in candidates:
        target = globals().get(candidate_name)
        if callable(target) or isinstance(target, type):
            return target

        for _, candidate in globals().items():
            if isinstance(candidate, type):
                try:
                    instance = candidate()
                except Exception:
                    continue

                method = getattr(instance, candidate_name, None)
                if callable(method):
                    return method

    return None


def _wrap_candidate(target):
    if not callable(target):
        return target

    def _wrapped(*args, **kwargs):
        try:
            return target(*args, **kwargs)
        except TypeError as error:
            message = str(error)
            if kwargs and "unexpected keyword argument" in message:
                return target(*kwargs.values())
            raise

    return _wrapped
`
}

function buildGenericHarnessCore() {
  return `def _parse_value(raw):
    if isinstance(raw, (int, float, bool, list, tuple, dict)) or raw is None:
        return raw

    if not isinstance(raw, str):
        return raw

    text = raw.strip()
    if text == "":
        return ""

    for parser in (json.loads, ast.literal_eval):
        try:
            return parser(text)
        except Exception:
            pass

    if "=" in text:
        parts = []
        depth = 0
        start = 0
        for index, char in enumerate(text):
            if char in "([{" :
                depth += 1
            elif char in ")]}" and depth > 0:
                depth -= 1
            elif char == "," and depth == 0:
                parts.append(text[start:index].strip())
                start = index + 1
        parts.append(text[start:].strip())

        assignments = {}
        valid = True
        for part in parts:
            if "=" not in part:
                valid = False
                break
            key, value_text = part.split("=", 1)
            key = key.strip()
            if not key:
                valid = False
                break
            assignments[key] = _parse_value(value_text.strip())

        if valid and assignments:
            return assignments

    return raw


def _run_design_sequence(target, parsed_input):
    methods = parsed_input.get("methods")
    arguments = parsed_input.get("arguments")

    if not isinstance(methods, list) or not isinstance(arguments, list):
        raise RuntimeError("Design-style test case is missing methods/arguments arrays")

    if len(methods) == 0 or len(arguments) != len(methods):
        raise RuntimeError("Design-style test case has mismatched methods/arguments lengths")

    constructor_args = arguments[0] if arguments else []
    if not isinstance(constructor_args, (list, tuple)):
        constructor_args = [constructor_args]

    obj = target(*constructor_args)
    outputs = [None]

    for method_name, method_args in zip(methods[1:], arguments[1:]):
        if not isinstance(method_args, (list, tuple)):
            method_args = [method_args]
        method = getattr(obj, method_name)
        outputs.append(method(*method_args))

    return outputs


def _call_target(target, parsed_input):
    if isinstance(parsed_input, dict) and isinstance(parsed_input.get("methods"), list):
        return _run_design_sequence(target, parsed_input)

    if isinstance(parsed_input, dict):
        try:
            return target(**parsed_input)
        except TypeError as error:
            message = str(error)
            if "unexpected keyword argument" in message:
                return target(*parsed_input.values())
            raise

    if isinstance(parsed_input, (list, tuple)):
        return target(*parsed_input)

    return target(parsed_input)
`
}

function buildDatasetCompatibilityBlock() {
  return `null = None
true = True
false = False

if "TreeNode" not in globals():
    class TreeNode:
        def __init__(self, val=0, left=None, right=None):
            self.val = val
            self.left = left
            self.right = right

if "ListNode" not in globals():
    class ListNode:
        def __init__(self, val=0, next=None):
            self.val = val
            self.next = next

def tree_node(values):
    if values is None:
        return None
    if not isinstance(values, (list, tuple)):
        return values
    values = list(values)
    if not values or values[0] is None:
        return None

    root = TreeNode(values[0])
    queue = deque([root])
    index = 1

    while queue and index < len(values):
        node = queue.popleft()

        if index < len(values):
            left_val = values[index]
            index += 1
            if left_val is not None:
                node.left = TreeNode(left_val)
                queue.append(node.left)

        if index < len(values):
            right_val = values[index]
            index += 1
            if right_val is not None:
                node.right = TreeNode(right_val)
                queue.append(node.right)

    return root

def list_node(values):
    if values is None:
        return None
    if not isinstance(values, (list, tuple)):
        return values
    values = list(values)
    if len(values) == 0:
        return None

    head = ListNode(values[0])
    current = head
    for value in values[1:]:
        current.next = ListNode(value)
        current = current.next
    return head

def is_same_list(a, b, limit=5000):
    seen_a = set()
    seen_b = set()

    while a is not None and b is not None:
        if id(a) in seen_a or id(b) in seen_b:
            return id(a) in seen_a and id(b) in seen_b
        seen_a.add(id(a))
        seen_b.add(id(b))
        if getattr(a, "val", object()) != getattr(b, "val", object()):
            return False
        a = getattr(a, "next", None)
        b = getattr(b, "next", None)
        limit -= 1
        if limit <= 0:
            break

    return a is None and b is None

def is_same_tree(a, b, limit=10000):
    queue = deque([(a, b)])
    seen = 0

    while queue:
        left, right = queue.popleft()
        seen += 1
        if seen > limit:
            return False

        if left is None and right is None:
            continue
        if left is None or right is None:
            return False
        if getattr(left, "val", object()) != getattr(right, "val", object()):
            return False

        queue.append((getattr(left, "left", None), getattr(right, "left", None)))
        queue.append((getattr(left, "right", None), getattr(right, "right", None)))

    return True
`
}

export function buildPythonHarness({ userCode, entryPoint, tests }) {
  const testsJson = JSON.stringify(
    (tests || []).map((test, index) => ({
      id: test.id,
      sort_order: test.sort_order ?? index + 1,
      input: test.input_text ?? '',
      expected: test.expected_output ?? '',
    })),
  )

  const safeEntryPoint = encodePythonString(entryPoint)
  const encodedTests = encodeBase64(testsJson)

  return `${buildPythonPrelude()}
ENTRY_POINT = ${safeEntryPoint}
TESTS = json.loads(base64.b64decode(${JSON.stringify(encodedTests)}).decode("utf-8"))
USER_STDOUT = io.StringIO()

${String(userCode || '')}

${buildResolveEntryBlock()}
${buildGenericHarnessCore()}

result = {
    "status": "error",
    "tests_total": len(TESTS),
    "tests_passed": 0,
    "cases": [],
    "message": "",
    "first_failed_case": None,
}

try:
    target = _resolve_entry(ENTRY_POINT)
    if target is None:
        raise RuntimeError(f"Entry point '{ENTRY_POINT}' not found in submitted code")
    target = _wrap_candidate(target)

    passed = 0

    for index, case in enumerate(TESTS, start=1):
        case_id = case.get("id", index)
        parsed_input = _parse_value(case.get("input"))
        expected = _parse_value(case.get("expected"))

        case_result = {
            "id": case_id,
            "sort_order": case.get("sort_order", index),
            "passed": False,
            "input": case.get("input"),
            "output": None,
            "expected": expected,
            "error": None,
        }

        try:
            case_stdout = io.StringIO()
            with contextlib.redirect_stdout(case_stdout):
                output = _call_target(target, parsed_input)
            captured_stdout = case_stdout.getvalue()
            if captured_stdout:
                USER_STDOUT.write(captured_stdout)
            case_result["output"] = output
            case_result["passed"] = output == expected
            if case_result["passed"]:
                passed += 1
        except Exception:
            case_result["error"] = traceback.format_exc(limit=6)

        result["cases"].append(case_result)

    result["tests_passed"] = passed
    result["status"] = "passed" if passed == len(TESTS) else "failed"
    result["message"] = f"{passed}/{len(TESTS)} tests passed"
    if result["status"] != "passed":
        for case_result in result["cases"]:
            if not case_result.get("passed"):
                result["first_failed_case"] = {
                    "sort_order": case_result.get("sort_order"),
                    "input": case_result.get("input"),
                    "expected": case_result.get("expected"),
                    "output": case_result.get("output"),
                    "error": case_result.get("error"),
                }
                break
except Exception:
    result["status"] = "error"
    result["message"] = traceback.format_exc(limit=8)

captured_stdout = USER_STDOUT.getvalue()
if captured_stdout:
    print(captured_stdout, end="")
print("__DSA_RUNNER_RESULT__" + json.dumps(result, ensure_ascii=False, default=str))
`
}

export function buildDatasetHarness({ userCode, entryPoint, datasetTestHarness, tests }) {
  const safeEntryPoint = encodePythonString(entryPoint)
  const encodedHarness = encodeBase64(datasetTestHarness)
  const testsTotal = Number.isFinite(Number(tests?.length)) ? Number(tests.length) : 0

  return `${buildPythonPrelude()}
ENTRY_POINT = ${safeEntryPoint}
DATASET_TEST_HARNESS = base64.b64decode(${JSON.stringify(encodedHarness)}).decode("utf-8")
TESTS_TOTAL = ${testsTotal}
USER_STDOUT = io.StringIO()

${String(userCode || '')}

${buildResolveEntryBlock()}
${buildDatasetCompatibilityBlock()}

result = {
    "status": "error",
    "tests_total": TESTS_TOTAL,
    "tests_passed": 0,
    "cases": [],
    "message": "",
    "first_failed_case": None,
}

try:
    scope = globals()
    exec(DATASET_TEST_HARNESS, scope, scope)
    check = scope.get("check")
    if not callable(check):
        raise RuntimeError("Dataset test harness did not define callable check(candidate)")

    candidate = _resolve_entry(ENTRY_POINT)
    if candidate is None:
        raise RuntimeError(f"Entry point '{ENTRY_POINT}' not found in submitted code")
    candidate = _wrap_candidate(candidate)

    with contextlib.redirect_stdout(USER_STDOUT):
        check(candidate)

    result["status"] = "passed"
    result["tests_passed"] = TESTS_TOTAL
    result["message"] = f"{TESTS_TOTAL}/{TESTS_TOTAL} tests passed"
except AssertionError as error:
    detail = str(error).strip() or "Assertion failed"
    result["status"] = "failed"
    result["message"] = detail
    result["first_failed_case"] = {"message": detail}
except Exception:
    detail = traceback.format_exc(limit=8)
    result["status"] = "error"
    result["message"] = detail
    result["first_failed_case"] = {"message": detail}

captured_stdout = USER_STDOUT.getvalue()
if captured_stdout:
    print(captured_stdout, end="")
print("__DSA_RUNNER_RESULT__" + json.dumps(result, ensure_ascii=False, default=str))
`
}

export function parseHarnessResult(stdoutText) {
  const raw = String(stdoutText || '')
  const marker = '__DSA_RUNNER_RESULT__'
  const markerIndex = raw.lastIndexOf(marker)

  if (markerIndex < 0) {
    return null
  }

  const payload = raw.slice(markerIndex + marker.length).trim()
  if (!payload) {
    return null
  }

  try {
    const parsed = JSON.parse(payload)
    if (parsed && typeof parsed === 'object') {
      return parsed
    }
    return null
  } catch {
    return null
  }
}
