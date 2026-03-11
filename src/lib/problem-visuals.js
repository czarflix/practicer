export const PROBLEM_VISUAL_MODEL = 'gemini-3-pro-image-preview'
export const PROBLEM_VISUAL_BUCKET = 'problem-images'
export const PROBLEM_VISUAL_PROMPT_VERSION = '2026-03-11-v2'
export const PROBLEM_VISUAL_MAX_EDGE = 1600
export const PROBLEM_VISUAL_THUMB_EDGE = 480
export const PROBLEM_VISUAL_MAX_BYTES = 1572864
export const PROBLEM_VISUAL_ALLOWED_SECTIONS = ['statement', 'examples', 'schema', 'requirements']
export const PROBLEM_VISUAL_ALLOWED_FORMATS = ['png', 'webp']
export const PROBLEM_VISUAL_ALLOWED_MIME_TYPES = ['image/png', 'image/webp']

const DSA_REQUIRED_PHASES = new Set(['Linked List', 'Trees', 'Graphs: BFS/DFS', 'Graphs: Advanced', 'Tries'])
const DSA_REQUIRED_CATEGORIES = new Set(['Intervals'])
const DSA_REQUIRED_TITLES = new Set([
  'Container With Most Water',
  'Trapping Rain Water',
  'Largest Rectangle In Histogram',
  'Maximal Rectangle',
  'Rotate Image',
  'Spiral Matrix',
  'Spiral Matrix II',
  'Set Matrix Zeroes',
  'Game of Life',
  'Valid Sudoku',
  'Sudoku Solver',
  'Search a 2D Matrix',
  'Search a 2D Matrix II',
  'Kth Smallest Element in a Sorted Matrix',
  'Unique Paths',
  'Unique Paths II',
  'Minimum Path Sum',
  'Longest Increasing Path In a Matrix',
  'Minesweeper',
  'N-Queens',
  'Path with Maximum Gold',
  'Median of Two Sorted Arrays',
  'Sliding Window Maximum',
  'Task Scheduler',
  '01 Matrix',
  'Flood Fill',
])

const SQL_REQUIRED_CATEGORIES = new Set([
  'Sessionization & Interval Reasoning',
  'Time Series Metrics: Rolling, MoM, YoY',
  'Gaps & Islands: Streaks and Contiguous Intervals',
  'Funnels, Retention, Cohorts, and Churn Metrics',
  'Schema Pivoting & Reshaping Output',
  'Advanced CTEs: Recursion, Expansion, and Hierarchies',
])

const SQL_REQUIRED_TITLES = new Set([
  'Median Employee Salary',
  'Average Waiting Time',
  'Biggest Window Between Visits',
  'User Session Activity',
])

function normalizeText(value, fallback = '') {
  const text = String(value || '').trim()
  return text || fallback
}

function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function buildDefaultAlt(problem, kindLabel) {
  return `${problem.title} ${kindLabel}`
}

function kindLabel(kind) {
  const normalized = normalizeText(kind)
  if (!normalized) {
    return 'instructional diagram'
  }

  return normalized.replace(/-/g, ' ')
}

function buildBaseVisual(problem, reason) {
  return {
    id: `${slugify(problem.problemKey || problem.problem_key || problem.title)}-primary`,
    problem_key: problem.problemKey || problem.problem_key,
    title: problem.title,
    track: problem.trackKey || problem.track_key,
    phase_name: problem.phaseName || problem.phase_name,
    category: problem.category,
    tier: problem.tier ?? null,
    study_order: problem.study_order ?? null,
    problem_lc: problem.problem_lc ?? null,
    source_platform: problem.source_platform || '',
    section: problem.trackKey === 'sql' || problem.track_key === 'sql' ? 'schema' : 'statement',
    sort_order: 0,
    source_model: PROBLEM_VISUAL_MODEL,
    prompt_version: PROBLEM_VISUAL_PROMPT_VERSION,
    preferred_format: 'webp',
    aspect_ratio: '16:9',
    coverage_reason: reason,
    image_path: '',
  }
}

function linkedListSpec(problem, reason) {
  return {
    ...buildBaseVisual(problem, reason),
    kind: 'linked-list-diagram',
    alt: buildDefaultAlt(problem, 'linked list pointer diagram'),
    caption: `Node order and pointer rewiring for ${problem.title}.`,
    assistant_context: 'Follow the colored pointers to see how nodes are rewired without reallocating the list.',
    prompt_brief: `Create a clean instructional linked-list diagram for "${problem.title}". Show the input list, the key pointer positions, any random or child links when relevant, and the final topology after the core operation.`,
  }
}

function treeSpec(problem, reason) {
  return {
    ...buildBaseVisual(problem, reason),
    kind: 'tree-diagram',
    aspect_ratio: '4:3',
    alt: buildDefaultAlt(problem, 'binary tree diagram'),
    caption: `Tree structure and highlighted traversal state for ${problem.title}.`,
    assistant_context: 'The highlighted nodes and paths show the exact subtree or traversal state that determines the result.',
    prompt_brief: `Create a clean instructional tree diagram for "${problem.title}". Show the rooted tree, highlight the relevant traversal, subtree, or ancestor path, and emphasize the result with minimal but crisp labels.`,
  }
}

function graphSpec(problem, reason) {
  return {
    ...buildBaseVisual(problem, reason),
    kind: 'graph-diagram',
    aspect_ratio: '4:3',
    alt: buildDefaultAlt(problem, 'graph traversal diagram'),
    caption: `Traversal state and highlighted edges for ${problem.title}.`,
    assistant_context: 'Use the colored frontier or highlighted path to understand how the graph state changes at each step.',
    prompt_brief: `Create a clean instructional graph diagram for "${problem.title}". Show the important nodes and edges, and highlight the traversal frontier, cycle, path, or weighted decision that drives the algorithm.`,
  }
}

function trieSpec(problem, reason) {
  return {
    ...buildBaseVisual(problem, reason),
    kind: 'trie-diagram',
    aspect_ratio: '4:3',
    alt: buildDefaultAlt(problem, 'trie diagram'),
    caption: `Prefix tree state for ${problem.title}.`,
    assistant_context: 'The highlighted prefix path shows how the query walks the trie and where matches terminate.',
    prompt_brief: `Create a clean instructional trie diagram for "${problem.title}". Show the prefix tree, terminal markers, and the active prefix path. If the problem uses a board, include a small board overlay linked to the trie search.`,
  }
}

function intervalSpec(problem, reason) {
  return {
    ...buildBaseVisual(problem, reason),
    kind: 'interval-timeline',
    alt: buildDefaultAlt(problem, 'interval timeline diagram'),
    caption: `Timeline overlap and grouping for ${problem.title}.`,
    assistant_context: 'Read the lanes left to right to see where intervals overlap, merge, or contribute to the answer.',
    prompt_brief: `Create a clean instructional interval timeline for "${problem.title}". Show each interval on horizontal lanes, highlight overlaps or merged ranges, and label the exact segment or concurrency count used in the solution.`,
  }
}

function gridSpec(problem, reason) {
  return {
    ...buildBaseVisual(problem, reason),
    kind: 'grid-diagram',
    aspect_ratio: '4:3',
    alt: buildDefaultAlt(problem, 'matrix or grid diagram'),
    caption: `Grid state and highlighted cells for ${problem.title}.`,
    assistant_context: 'The arrows and colored cells show the movement, transformation, or DP state that matters for the result.',
    prompt_brief: `Create a clean instructional grid or matrix diagram for "${problem.title}". Show the input board, the key arrows or transitions, highlight the important cells, and include the final board or selected result cells.`,
  }
}

function timelineSpec(problem, reason) {
  return {
    ...buildBaseVisual(problem, reason),
    kind: 'time-series-timeline',
    alt: buildDefaultAlt(problem, 'time-series diagram'),
    caption: `Time buckets and highlighted metric window for ${problem.title}.`,
    assistant_context: 'The labeled buckets show exactly which rows belong to the current period, prior period, or rolling window.',
    prompt_brief: `Create a clean instructional time-series diagram for "${problem.title}". Show the time buckets on an x-axis, highlight the rolling or comparison window, and label the numerator and denominator when a percentage or rate is involved.`,
  }
}

function sessionSpec(problem, reason) {
  return {
    ...buildBaseVisual(problem, reason),
    kind: 'session-timeline',
    alt: buildDefaultAlt(problem, 'session or interval timeline'),
    caption: `Session boundaries and interval reasoning for ${problem.title}.`,
    assistant_context: 'The swimlanes show how starts and ends are paired, merged, or compared to produce the metric.',
    prompt_brief: `Create a clean instructional session timeline for "${problem.title}". Use entity swimlanes, show starts and ends, highlight merged spans or gaps, and label the segment that contributes to the final metric.`,
  }
}

function streakSpec(problem, reason) {
  return {
    ...buildBaseVisual(problem, reason),
    kind: 'streak-timeline',
    alt: buildDefaultAlt(problem, 'streak or contiguous-range diagram'),
    caption: `Contiguous runs and streak grouping for ${problem.title}.`,
    assistant_context: 'The brackets and group labels show where a streak starts, continues, and resets.',
    prompt_brief: `Create a clean instructional streak diagram for "${problem.title}". Show ordered events or dates, bracket each contiguous run, and label the group ids or streak lengths that explain the SQL grouping logic.`,
  }
}

function cohortSpec(problem, reason) {
  return {
    ...buildBaseVisual(problem, reason),
    kind: 'cohort-funnel',
    alt: buildDefaultAlt(problem, 'cohort or funnel diagram'),
    caption: `Cohort progression and metric mapping for ${problem.title}.`,
    assistant_context: 'The highlighted cells show which users count in the numerator and denominator at each stage.',
    prompt_brief: `Create a clean instructional cohort or funnel diagram for "${problem.title}". Show the stage progression or cohort grid, highlight retained or churned users, and label the exact numerator and denominator used in the metric.`,
  }
}

function pivotSpec(problem, reason) {
  return {
    ...buildBaseVisual(problem, reason),
    kind: 'pivot-reshape',
    alt: buildDefaultAlt(problem, 'pivot or reshape diagram'),
    caption: `Tall-to-wide reshape for ${problem.title}.`,
    assistant_context: 'The arrows show how source rows are grouped and mapped into the final output columns.',
    prompt_brief: `Create a clean instructional pivot diagram for "${problem.title}". Show the source rows in a tall table, the grouping or pivot transform in the middle, and the final wide output table on the right.`,
  }
}

function hierarchySpec(problem, reason) {
  return {
    ...buildBaseVisual(problem, reason),
    kind: 'hierarchy-expansion',
    aspect_ratio: '4:3',
    alt: buildDefaultAlt(problem, 'hierarchy or expansion diagram'),
    caption: `Recursive expansion or generated series for ${problem.title}.`,
    assistant_context: 'The diagram shows how recursion or row expansion creates the derived set used by the query.',
    prompt_brief: `Create a clean instructional hierarchy or expansion diagram for "${problem.title}". Show the recursive hierarchy, generated sequence, or exploded frequency ladder that feeds the final SQL aggregation.`,
  }
}

const DSA_TITLE_SPECS = {
  '01 Matrix': {
    kind: 'grid-bfs',
    caption: 'Distances expand from zero cells across the matrix.',
    assistant_context: 'The wavefront coloring shows the multi-source BFS distance propagation.',
    prompt_brief: 'Create a clean matrix BFS diagram for "01 Matrix". Show zero cells as starting sources, a distance wave expanding outward, and the final distance values written into the grid.',
  },
  'Container With Most Water': {
    kind: 'two-pointer-area',
    caption: 'Width times the shorter wall determines the container area.',
    assistant_context: 'The chosen left and right walls, the width marker, and the shaded area show why the shorter side limits the answer.',
    prompt_brief: 'Create a clean example-style bar chart diagram for "Container With Most Water". Show the vertical bars from the sample, highlight one chosen left wall and one chosen right wall, and shade the water area between them. Keep the text minimal and limited to simple positional labels such as i and j if needed.',
  },
  'Flood Fill': {
    kind: 'grid-fill',
    caption: 'The connected component spreads from the start cell.',
    assistant_context: 'The colored region shows exactly which neighboring cells belong to the same component.',
    prompt_brief: 'Create a clean grid diagram for "Flood Fill". Show the starting cell, highlight the connected region reached by DFS or BFS, and show the updated color after the fill completes.',
  },
  'Game of Life': {
    kind: 'board-transition',
    caption: 'Live and dead cells transition based on neighboring counts.',
    assistant_context: 'The side-by-side boards and annotated neighbor counts explain why specific cells survive, die, or become live.',
    prompt_brief: 'Create a clean side-by-side board diagram for "Game of Life". Show the input board, annotate a few representative neighbor counts, and show the next-state board with changed cells highlighted.',
  },
  'Kth Smallest Element in a Sorted Matrix': {
    kind: 'matrix-selection',
    caption: 'The smallest frontier values advance across the sorted matrix.',
    assistant_context: 'The highlighted frontier shows how the next candidate is chosen from the matrix.',
    prompt_brief: 'Create a clean sorted-matrix diagram for "Kth Smallest Element in a Sorted Matrix". Show the matrix, highlight the current frontier of candidates, and emphasize the element selected as the kth smallest.',
  },
  'Largest Rectangle In Histogram': {
    kind: 'histogram-rectangle',
    caption: 'The winning rectangle spans the bars between its limiting boundaries.',
    assistant_context: 'The boxed rectangle and boundary markers show why that width and height produce the maximum area.',
    prompt_brief: 'Create a clean histogram diagram for "Largest Rectangle In Histogram". Show the bar chart, highlight the maximum-area rectangle, and label the limiting left and right boundaries for that height.',
  },
  'Longest Increasing Path In a Matrix': {
    kind: 'matrix-path',
    caption: 'Strictly increasing moves define the longest path through the grid.',
    assistant_context: 'The numbered arrows show one longest valid increasing path across the matrix.',
    prompt_brief: 'Create a clean matrix path diagram for "Longest Increasing Path In a Matrix". Show the grid values, highlight one longest strictly increasing path with numbered arrows, and emphasize the path length.',
  },
  'Maximal Rectangle': {
    kind: 'matrix-rectangle',
    caption: 'The largest all-ones rectangle is highlighted inside the binary matrix.',
    assistant_context: 'The boxed region and histogram cue show how the matrix row builds the maximum rectangle.',
    prompt_brief: 'Create a clean binary-matrix diagram for "Maximal Rectangle". Show the matrix of 0s and 1s, highlight the largest all-ones rectangle, and include a small hint of the histogram interpretation underneath.',
  },
  'Median of Two Sorted Arrays': {
    kind: 'partition-diagram',
    caption: 'Partition lines split the two arrays into balanced left and right halves.',
    assistant_context: 'The partition bars show how the median is determined from the border values of both arrays.',
    prompt_brief: 'Create a clean partition diagram for "Median of Two Sorted Arrays". Show both sorted arrays as horizontal rows, add partition bars, highlight the balanced left and right halves, and label the border values used to compute the median.',
  },
  Minesweeper: {
    kind: 'board-reveal',
    caption: 'Reveal propagation expands through zero-adjacent cells while preserving numbered boundaries.',
    assistant_context: 'The highlighted frontier shows how the reveal fans out until it reaches numbered cells.',
    prompt_brief: 'Create a clean minesweeper board diagram for "Minesweeper". Show unrevealed cells, mines, numbered boundary cells, and the reveal propagation from the clicked cell.',
  },
  'Minimum Path Sum': {
    kind: 'grid-dp',
    caption: 'Each cell accumulates the cheapest path from the top-left corner.',
    assistant_context: 'The overlaid DP values show how each cell inherits the minimum from its top or left neighbor.',
    prompt_brief: 'Create a clean DP grid diagram for "Minimum Path Sum". Show the input weights, overlay the running minimum path sums, and highlight the cheapest path from the start to the destination.',
  },
  'N-Queens': {
    kind: 'queen-board',
    aspect_ratio: '4:3',
    caption: 'Queens are placed so rows, columns, and diagonals never conflict.',
    assistant_context: 'The attack lines show why certain placements are invalid and why the highlighted arrangement works.',
    prompt_brief: 'Create a clean chessboard diagram for "N-Queens". Show a valid queen placement, mark attacked rows, columns, and diagonals, and make the conflict-free structure obvious.',
  },
  'Path with Maximum Gold': {
    kind: 'grid-path',
    caption: 'A single non-revisiting path collects the highlighted gold cells.',
    assistant_context: 'The numbered path shows the high-value route through the grid without revisiting cells.',
    prompt_brief: 'Create a clean grid path diagram for "Path with Maximum Gold". Show the gold values, highlight one optimal path with numbered arrows, and emphasize that cells cannot be revisited.',
  },
  'Rotate Image': {
    kind: 'matrix-rotation',
    caption: 'Transpose and reverse operations rotate the matrix 90 degrees clockwise.',
    assistant_context: 'The paired cells and arrows show how each original position moves to its rotated location.',
    prompt_brief: 'Create a clean before-and-after matrix diagram for "Rotate Image". Show the original matrix, the rotated matrix, and arrows connecting representative cells from old to new positions.',
  },
  'Search a 2D Matrix': {
    kind: 'matrix-search',
    caption: 'The matrix is treated as an ordered search space.',
    assistant_context: 'The highlighted midpoint steps show how binary search narrows to the target cell.',
    prompt_brief: 'Create a clean matrix search diagram for "Search a 2D Matrix". Show the sorted rows, highlight a few midpoint checks, and mark the target cell reached by binary search.',
  },
  'Search a 2D Matrix II': {
    kind: 'matrix-elimination',
    caption: 'Each comparison eliminates a full row or column from consideration.',
    assistant_context: 'The elimination shading shows how the search space shrinks from the matrix corner.',
    prompt_brief: 'Create a clean matrix elimination diagram for "Search a 2D Matrix II". Show the target search starting from a corner, shade eliminated rows or columns, and mark the remaining candidate region after each comparison.',
  },
  'Set Matrix Zeroes': {
    kind: 'matrix-zeroing',
    caption: 'Rows and columns touching a zero are marked for overwrite.',
    assistant_context: 'The highlighted markers show how zero positions propagate across the matrix.',
    prompt_brief: 'Create a clean matrix transformation diagram for "Set Matrix Zeroes". Show the original matrix, highlight the rows and columns that must be zeroed, and show the final transformed matrix.',
  },
  'Sliding Window Maximum': {
    kind: 'window-deque',
    caption: 'The active window and deque state produce the current maximum.',
    assistant_context: 'The deque view shows why smaller trailing elements are dropped before the next step.',
    prompt_brief: 'Create a clean array-and-deque diagram for "Sliding Window Maximum". Show the active window over the array, the deque contents for the current step, and the maximum emitted for each slide.',
  },
  'Spiral Matrix': {
    kind: 'spiral-order',
    caption: 'Layer-by-layer traversal peels the matrix in spiral order.',
    assistant_context: 'The numbered arrows show the direction changes and boundary tightening after each edge.',
    prompt_brief: 'Create a clean matrix traversal diagram for "Spiral Matrix". Show the matrix with numbered arrows tracing the spiral order and mark the shrinking boundaries for each layer.',
  },
  'Spiral Matrix II': {
    kind: 'spiral-fill',
    caption: 'Numbers fill the matrix while the spiral boundaries shrink inward.',
    assistant_context: 'The numbered fill order shows how the current boundary changes after each directional pass.',
    prompt_brief: 'Create a clean matrix fill diagram for "Spiral Matrix II". Show the square matrix being filled in spiral order with numbered arrows and clear boundary updates.',
  },
  'Sudoku Solver': {
    kind: 'sudoku-backtracking',
    aspect_ratio: '4:3',
    caption: 'Backtracking places valid digits while preserving row, column, and box constraints.',
    assistant_context: 'The highlighted row, column, and sub-box show why a candidate digit is allowed or rejected.',
    prompt_brief: 'Create a clean sudoku solving diagram for "Sudoku Solver". Show the board, highlight one target empty cell, annotate row-column-box constraints, and show a valid candidate placement.',
  },
  'Task Scheduler': {
    kind: 'schedule-timeline',
    caption: 'Repeated tasks are spaced across a timeline with cooldown gaps when needed.',
    assistant_context: 'The slot labels show how the schedule avoids illegal repeats and where idle time appears.',
    prompt_brief: 'Create a clean scheduling timeline for "Task Scheduler". Show repeated task labels on time slots, highlight cooldown spacing, and include idle slots only where necessary.',
  },
  'Trapping Rain Water': {
    kind: 'rainwater-histogram',
    caption: 'Water accumulates above bars up to the lower of the left and right boundaries.',
    assistant_context: 'The left-max and right-max guides show why each shaded pocket holds that depth of water.',
    prompt_brief: 'Create a clean example-style histogram diagram for "Trapping Rain Water". Show the bar heights from the sample and shade the trapped water regions. Keep the text minimal and avoid extra guides or explanatory labels.',
  },
  'Unique Paths': {
    kind: 'grid-path-count',
    caption: 'Each cell count equals the sum of paths from the top and left.',
    assistant_context: 'The overlaid path counts show how the total accumulates across the grid.',
    prompt_brief: 'Create a clean path-count grid diagram for "Unique Paths". Show a small grid with DP path counts overlaid, arrows from the top and left, and the final count at the destination.',
  },
  'Unique Paths II': {
    kind: 'grid-obstacle-path-count',
    caption: 'Obstacles block transitions while path counts still accumulate around them.',
    assistant_context: 'The obstacle cells and overlaid path counts show how blocked moves zero out parts of the DP table.',
    prompt_brief: 'Create a clean obstacle-grid diagram for "Unique Paths II". Show the grid, mark obstacle cells, overlay DP path counts for reachable cells, and highlight the final count at the destination.',
  },
  'Valid Sudoku': {
    kind: 'sudoku-constraints',
    aspect_ratio: '4:3',
    caption: 'Rows, columns, and 3x3 boxes must each contain unique digits.',
    assistant_context: 'The colored row, column, and sub-box make the violated or checked constraint immediately visible.',
    prompt_brief: 'Create a clean sudoku constraint diagram for "Valid Sudoku". Show the 9x9 board, highlight one row, one column, and one 3x3 box, and mark how uniqueness is checked across all three.',
  },
}

const SQL_TITLE_SPECS = {
  'Average Waiting Time': {
    kind: 'queue-timeline',
    caption: 'Arrival, service start, and completion times define each customer wait.',
    assistant_context: 'The queue timeline shows how each wait is measured from arrival until service actually begins.',
    prompt_brief: 'Create a clean queue timeline for "Average Waiting Time". Show customers arriving over time, their service start and end times, and highlight the waiting segment for each customer.',
  },
  'Biggest Window Between Visits': {
    kind: 'visit-gap-timeline',
    caption: 'The largest gap is measured between ordered visit events.',
    assistant_context: 'The highlighted spacing between visits shows the exact window being ranked as the largest.',
    prompt_brief: 'Create a clean event-gap timeline for "Biggest Window Between Visits". Show ordered visit timestamps for a user and highlight the largest gap between two consecutive visits.',
  },
  'Median Employee Salary': {
    kind: 'ordered-median',
    caption: 'Sorted salary rows reveal the middle employee or middle pair within each company.',
    assistant_context: 'The highlighted rows show the odd and even median cases after ordering salaries.',
    prompt_brief: 'Create a clean ordered-row diagram for "Median Employee Salary". Show employee salary rows sorted within a company, highlight the middle row or middle pair, and label the median selection logic.',
  },
  'Median Google Search Frequency': {
    kind: 'frequency-median',
    caption: 'Expanded frequency positions reveal the middle search counts.',
    assistant_context: 'The frequency ladder shows how repeated counts expand into ordered positions before choosing the median.',
    prompt_brief: 'Create a clean frequency-expansion diagram for "Median Google Search Frequency". Show search counts with frequencies, expand them into ordered positions, and highlight the middle value or middle pair.',
  },
  'User Session Activity': {
    kind: 'session-gap-timeline',
    caption: 'Ordered events define the active session window for each user.',
    assistant_context: 'The highlighted session span shows which events belong together before aggregation.',
    prompt_brief: 'Create a clean session timeline for "User Session Activity". Show user events ordered over time, highlight the session window, and label the interval used for the final metric.',
  },
}

function applyOverride(base, override) {
  if (!override) {
    return base
  }

  const nextKind = override.kind || base.kind
  return {
    ...base,
    ...override,
    alt: override.alt || buildDefaultAlt(base, kindLabel(nextKind)),
    caption: override.caption || base.caption,
    assistant_context: override.assistant_context || base.assistant_context,
    prompt_brief: override.prompt_brief || base.prompt_brief,
    aspect_ratio: override.aspect_ratio || base.aspect_ratio,
    kind: nextKind,
  }
}

function normalizeProblemRow(problem) {
  return {
    problem_key: normalizeText(problem.problem_key || problem.problemKey),
    title: normalizeText(problem.title),
    track_key: normalizeText(problem.track_key || problem.trackKey),
    phase_name: normalizeText(problem.phase_name || problem.phaseName),
    category: normalizeText(problem.category),
    source_platform: normalizeText(problem.source_platform || problem.sourcePlatform),
    tier: toNumber(problem.tier),
    study_order: toNumber(problem.study_order || problem.studyOrder),
    problem_lc: toNumber(problem.problem_lc || problem.problemLc),
  }
}

function buildDsaVisual(problem) {
  const explicit = DSA_TITLE_SPECS[problem.title]
  const required =
    DSA_REQUIRED_PHASES.has(problem.phase_name) ||
    DSA_REQUIRED_CATEGORIES.has(problem.category) ||
    DSA_REQUIRED_TITLES.has(problem.title)

  if (!required) {
    return null
  }

  let base = null
  let reason = ''

  if (problem.phase_name === 'Linked List') {
    reason = 'phase:Linked List'
    base = linkedListSpec({ ...problem, trackKey: 'dsa' }, reason)
  } else if (problem.phase_name === 'Trees') {
    reason = 'phase:Trees'
    base = treeSpec({ ...problem, trackKey: 'dsa' }, reason)
  } else if (problem.phase_name === 'Graphs: BFS/DFS' || problem.phase_name === 'Graphs: Advanced') {
    reason = `phase:${problem.phase_name}`
    base = graphSpec({ ...problem, trackKey: 'dsa' }, reason)
  } else if (problem.phase_name === 'Tries') {
    reason = 'phase:Tries'
    base = trieSpec({ ...problem, trackKey: 'dsa' }, reason)
  } else if (problem.category === 'Intervals') {
    reason = 'category:Intervals'
    base = intervalSpec({ ...problem, trackKey: 'dsa' }, reason)
  } else {
    reason = `title:${problem.title}`
    base = gridSpec({ ...problem, trackKey: 'dsa' }, reason)
  }

  return applyOverride(base, explicit)
}

function buildSqlVisual(problem) {
  const explicit = SQL_TITLE_SPECS[problem.title]
  const required = SQL_REQUIRED_CATEGORIES.has(problem.category) || SQL_REQUIRED_TITLES.has(problem.title)

  if (!required) {
    return null
  }

  let base = null
  let reason = ''

  if (problem.category === 'Sessionization & Interval Reasoning') {
    reason = 'category:Sessionization & Interval Reasoning'
    base = sessionSpec({ ...problem, trackKey: 'sql' }, reason)
  } else if (problem.category === 'Time Series Metrics: Rolling, MoM, YoY') {
    reason = 'category:Time Series Metrics: Rolling, MoM, YoY'
    base = timelineSpec({ ...problem, trackKey: 'sql' }, reason)
  } else if (problem.category === 'Gaps & Islands: Streaks and Contiguous Intervals') {
    reason = 'category:Gaps & Islands: Streaks and Contiguous Intervals'
    base = streakSpec({ ...problem, trackKey: 'sql' }, reason)
  } else if (problem.category === 'Funnels, Retention, Cohorts, and Churn Metrics') {
    reason = 'category:Funnels, Retention, Cohorts, and Churn Metrics'
    base = cohortSpec({ ...problem, trackKey: 'sql' }, reason)
  } else if (problem.category === 'Schema Pivoting & Reshaping Output') {
    reason = 'category:Schema Pivoting & Reshaping Output'
    base = pivotSpec({ ...problem, trackKey: 'sql' }, reason)
  } else if (problem.category === 'Advanced CTEs: Recursion, Expansion, and Hierarchies') {
    reason = 'category:Advanced CTEs: Recursion, Expansion, and Hierarchies'
    base = hierarchySpec({ ...problem, trackKey: 'sql' }, reason)
  } else {
    reason = `title:${problem.title}`
    base = timelineSpec({ ...problem, trackKey: 'sql' }, reason)
  }

  return applyOverride(base, explicit)
}

export function buildProblemVisualSpec(problemInput) {
  const problem = normalizeProblemRow(problemInput)
  if (!problem.problem_key || !problem.title || !problem.track_key) {
    return null
  }

  if (problem.track_key === 'dsa') {
    return buildDsaVisual(problem)
  }

  if (problem.track_key === 'sql') {
    return buildSqlVisual(problem)
  }

  return null
}

export function problemRequiresVisual(problemInput) {
  return Boolean(buildProblemVisualSpec(problemInput))
}

export function buildProblemVisualManifest(rows) {
  return rows
    .map((row) => buildProblemVisualSpec(row))
    .filter(Boolean)
    .sort((left, right) => {
      if (left.track !== right.track) {
        return left.track.localeCompare(right.track)
      }
      if ((left.tier ?? 0) !== (right.tier ?? 0)) {
        return (left.tier ?? 0) - (right.tier ?? 0)
      }
      if ((left.study_order ?? 0) !== (right.study_order ?? 0)) {
        return (left.study_order ?? 0) - (right.study_order ?? 0)
      }
      return left.title.localeCompare(right.title)
    })
}

export function normalizeProblemVisualRecord(rawVisual, fallbackIndex = 0) {
  if (!rawVisual || typeof rawVisual !== 'object' || Array.isArray(rawVisual)) {
    return null
  }

  const section = normalizeText(rawVisual.section || rawVisual.placement, 'statement')
  if (!PROBLEM_VISUAL_ALLOWED_SECTIONS.includes(section)) {
    return null
  }

  const publicUrl = normalizeText(rawVisual.public_url || rawVisual.src)
  if (!publicUrl) {
    return null
  }

  const thumbUrl = normalizeText(rawVisual.thumb_url || rawVisual.thumb_src || publicUrl, publicUrl)
  const mimeType = normalizeText(rawVisual.mime_type || rawVisual.mimeType)
  const sortOrder = toNumber(rawVisual.sort_order)

  return {
    id: normalizeText(rawVisual.id, `problem-visual-${fallbackIndex + 1}`),
    section,
    example_index: toNumber(rawVisual.example_index ?? rawVisual.exampleIndex),
    kind: normalizeText(rawVisual.kind, 'diagram'),
    public_url: publicUrl,
    thumb_url: thumbUrl,
    storage_path: normalizeText(rawVisual.storage_path || rawVisual.storagePath),
    mime_type: mimeType,
    width: toNumber(rawVisual.width),
    height: toNumber(rawVisual.height),
    alt: normalizeText(rawVisual.alt),
    caption: normalizeText(rawVisual.caption),
    assistant_context: normalizeText(rawVisual.assistant_context || rawVisual.assistantContext),
    source_model: normalizeText(rawVisual.source_model || rawVisual.sourceModel),
    prompt_version: normalizeText(rawVisual.prompt_version || rawVisual.promptVersion),
    sort_order: sortOrder ?? fallbackIndex,
  }
}

export function extractProblemVisuals(presentation, section = '') {
  const visuals = Array.isArray(presentation?.visuals)
    ? presentation.visuals
    : Array.isArray(presentation?.Visuals)
      ? presentation.Visuals
      : []

  return visuals
    .map((visual, index) => normalizeProblemVisualRecord(visual, index))
    .filter(Boolean)
    .filter((visual) => {
      if (!section) {
        return true
      }
      return visual.section === section
    })
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
}
