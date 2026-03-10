#!/bin/bash
# Live test against the runner for a few of the 27 problems
# Tests both REGULAR and DESIGN pattern problems

RUNNER="https://runner.czarflix.me"
USER_KEY="test-audit-$(date +%s)"

run_test() {
  local LC=$1
  local LABEL=$2
  local CODE=$3
  
  echo "=== LC $LC: $LABEL ==="
  
  # Create run
  RESPONSE=$(curl -s -X POST "$RUNNER/runs" \
    -H "Content-Type: application/json" \
    -d "{\"user_key\":\"$USER_KEY\",\"problem_lc\":$LC,\"code\":$(echo "$CODE" | jq -Rs .),\"mode\":\"run\"}")
  
  RUN_ID=$(echo "$RESPONSE" | jq -r '.id // empty')
  ERROR=$(echo "$RESPONSE" | jq -r '.error // empty')
  
  if [ -n "$ERROR" ]; then
    echo "  CREATE ERROR: $ERROR"
    echo ""
    return
  fi
  
  if [ -z "$RUN_ID" ]; then
    echo "  NO RUN ID. Response: $RESPONSE"
    echo ""
    return
  fi
  
  echo "  Run ID: $RUN_ID"
  
  # Poll for result (max 15 seconds)
  for i in $(seq 1 15); do
    sleep 1
    RESULT=$(curl -s "$RUNNER/runs/$RUN_ID?user_key=$USER_KEY")
    STATUS=$(echo "$RESULT" | jq -r '.status')
    
    if [ "$STATUS" != "queued" ] && [ "$STATUS" != "running" ]; then
      PASSED=$(echo "$RESULT" | jq -r '.tests_passed')
      TOTAL=$(echo "$RESULT" | jq -r '.tests_total')
      MSG=$(echo "$RESULT" | jq -r '.message // .summary // empty')
      STDERR=$(echo "$RESULT" | jq -r '.stderr // empty' | head -5)
      echo "  Status: $STATUS | Passed: $PASSED/$TOTAL"
      [ -n "$MSG" ] && echo "  Message: $(echo "$MSG" | head -3)"
      [ -n "$STDERR" ] && echo "  Stderr: $(echo "$STDERR" | head -3)"
      echo ""
      return
    fi
  done
  
  echo "  TIMEOUT: still $STATUS after 15s"
  echo ""
}

echo "Testing REGULAR problems from the 27..."
echo ""

# LC 372 - Super Pow (regular, entry: Solution)
run_test 372 "Super Pow (REGULAR)" "
class Solution:
    def superPow(self, a, b):
        def power(a, n, mod=1337):
            result = 1
            a %= mod
            while n > 0:
                if n % 2 == 1:
                    result = result * a % mod
                a = a * a % mod
                n //= 2
            return result
        
        result = 1
        for digit in b:
            result = power(result, 10) * power(a, digit) % 1337
        return result
"

# LC 235 - LCA of BST (regular, entry: Solution)  
run_test 235 "LCA of BST (REGULAR)" "
class TreeNode:
    def __init__(self, x):
        self.val = x
        self.left = None
        self.right = None

class Solution:
    def lowestCommonAncestor(self, root, p, q):
        while root:
            if p.val < root.val and q.val < root.val:
                root = root.left
            elif p.val > root.val and q.val > root.val:
                root = root.right
            else:
                return root
"

echo ""
echo "Testing DESIGN problems from the 27..."
echo ""

# LC 146 - LRU Cache (design, entry: LRUCache)
run_test 146 "LRU Cache (DESIGN)" "
from collections import OrderedDict

class LRUCache:
    def __init__(self, capacity):
        self.cache = OrderedDict()
        self.capacity = capacity
    
    def get(self, key):
        if key not in self.cache:
            return -1
        self.cache.move_to_end(key)
        return self.cache[key]
    
    def put(self, key, value):
        if key in self.cache:
            self.cache.move_to_end(key)
        self.cache[key] = value
        if len(self.cache) > self.capacity:
            self.cache.popitem(last=False)
"

# LC 155 - Min Stack (design, entry: MinStack)
run_test 155 "Min Stack (DESIGN)" "
class MinStack:
    def __init__(self):
        self.stack = []
        self.min_stack = []
    
    def push(self, val):
        self.stack.append(val)
        if not self.min_stack or val <= self.min_stack[-1]:
            self.min_stack.append(val)
    
    def pop(self):
        if self.stack[-1] == self.min_stack[-1]:
            self.min_stack.pop()
        self.stack.pop()
    
    def top(self):
        return self.stack[-1]
    
    def getMin(self):
        return self.min_stack[-1]
"

# LC 208 - Implement Trie (design, entry: Trie)
run_test 208 "Implement Trie (DESIGN)" "
class Trie:
    def __init__(self):
        self.children = {}
        self.is_end = False
    
    def insert(self, word):
        node = self
        for c in word:
            if c not in node.children:
                node.children[c] = Trie()
            node = node.children[c]
        node.is_end = True
    
    def search(self, word):
        node = self
        for c in word:
            if c not in node.children:
                return False
            node = node.children[c]
        return node.is_end
    
    def startsWith(self, prefix):
        node = self
        for c in prefix:
            if c not in node.children:
                return False
            node = node.children[c]
        return True
"

echo "=== DONE ==="
