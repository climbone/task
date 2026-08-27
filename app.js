// ===================== 永続化(localStorage) =====================
const STORAGE_KEY = "taskline-data";
const THEME_KEY = "taskline-theme";

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.error("loadState failed", err);
  }
  return {
    lists: [
      { id: "inbox", name: "Inbox", icon: "inbox" },
    ],
    tasks: [],
  };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setStatus("保存しました");
  } catch (err) {
    console.error("saveState failed", err);
    setStatus("保存に失敗しました");
  }
}

let state = loadState();
let currentFilter = "all";
let currentListId = "__all__";
let currentSort = "created";
let searchQuery = "";
let taskCounter = 0;
let listCounter = 0;

// ===================== DOM =====================
const $ = (id) => document.getElementById(id);

const newTaskBtn = $("newTaskBtn");
const sortBtn = $("sortBtn");
const sortMenu = $("sortMenu");
const findBtn = $("findBtn");
const findPanel = $("findPanel");
const findInput = $("findInput");
const findCount = $("findCount");
const findCloseBtn = $("findCloseBtn");
const clearCompletedBtn = $("clearCompletedBtn");
const themeBtn = $("themeBtn");

const tabbar = $("tabbar");
const listNav = $("listNav");
const addListBtn = $("addListBtn");

const composePanel = $("composePanel");
const composeTitle = $("composeTitle");
const composeList = $("composeList");
const composeDue = $("composeDue");
const composePriority = $("composePriority");
const composeAddBtn = $("composeAddBtn");
const composeCloseBtn = $("composeCloseBtn");

const editPanel = $("editPanel");
const editTitle = $("editTitle");
const editList = $("editList");
const editDue = $("editDue");
const editPriority = $("editPriority");
const editSaveBtn = $("editSaveBtn");
const editDeleteBtn = $("editDeleteBtn");
const editCloseBtn = $("editCloseBtn");
let editingTaskId = null;

const taskListEl = $("taskList");
const emptyState = $("emptyState");

const currentListLabel = $("currentListLabel");
const remainingCountEl = $("remainingCount");
const doneCountEl = $("doneCount");
const totalCountEl = $("totalCount");
const statusMsg = $("statusMsg");

const countAll = $("countAll");
const countToday = $("countToday");
const countOverdue = $("countOverdue");
const countActive = $("countActive");
const countCompleted = $("countCompleted");

// ===================== ユーティリティ =====================
function todayStr() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function setStatus(msg) {
  statusMsg.textContent = msg;
}

function makeTaskId() {
  taskCounter += 1;
  return `task-${Date.now()}-${taskCounter}`;
}

function makeListId() {
  listCounter += 1;
  return `list-${Date.now()}-${listCounter}`;
}

function priorityLabel(p) {
  return { high: "高", mid: "中", low: "低" }[p] || "中";
}

function priorityWeight(p) {
  return { high: 0, mid: 1, low: 2 }[p] ?? 1;
}

// ===================== リスト管理 =====================
function renderListNav() {
  listNav.innerHTML = "";

  const allItem = buildListNavItem({
    id: "__all__",
    name: "すべてのタスク",
    icon: "layers",
    count: state.tasks.length,
    deletable: false,
  });
  listNav.appendChild(allItem);

  state.lists.forEach((list) => {
    const count = state.tasks.filter((t) => t.listId === list.id).length;
    listNav.appendChild(
      buildListNavItem({
        id: list.id,
        name: list.name,
        icon: list.icon || "folder",
        count,
        deletable: state.lists.length > 1,
      })
    );
  });

  // compose / edit パネルのリスト選択肢も更新
  populateListSelect(composeList, currentListId !== "__all__" ? currentListId : null);
  populateListSelect(editList, editingTaskId ? state.tasks.find((t) => t.id === editingTaskId)?.listId : null);
}

function populateListSelect(selectEl, fallbackValue) {
  const prevValue = selectEl.value;
  selectEl.innerHTML = state.lists
    .map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`)
    .join("");
  if (state.lists.some((l) => l.id === prevValue)) {
    selectEl.value = prevValue;
  } else if (fallbackValue && state.lists.some((l) => l.id === fallbackValue)) {
    selectEl.value = fallbackValue;
  }
}

function buildListNavItem({ id, name, icon, count, deletable }) {
  const btn = document.createElement("button");
  btn.className = "list-nav-item" + (currentListId === id ? " active" : "");
  btn.dataset.listId = id;
  btn.innerHTML = `
    <span class="material-symbols-outlined">${icon}</span>
    <span class="list-nav-name">${escapeHtml(name)}</span>
    <span class="list-nav-count">${count}</span>
    ${deletable ? `<button class="list-nav-delete" data-delete-list="${id}" title="リストを削除"><span class="material-symbols-outlined">close</span></button>` : ""}
  `;
  btn.addEventListener("click", (e) => {
    if (e.target.closest("[data-delete-list]")) return;
    currentListId = id;
    render();
  });
  const delBtn = btn.querySelector("[data-delete-list]");
  if (delBtn) {
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteList(id);
    });
  }
  return btn;
}

function deleteList(listId) {
  if (state.lists.length <= 1) return;
  const list = state.lists.find((l) => l.id === listId);
  if (!list) return;
  if (!confirm(`リスト「${list.name}」を削除しますか?中のタスクも削除されます。`)) return;
  state.lists = state.lists.filter((l) => l.id !== listId);
  state.tasks = state.tasks.filter((t) => t.listId !== listId);
  if (currentListId === listId) currentListId = "__all__";
  saveState();
  render();
}

addListBtn.addEventListener("click", () => {
  const name = prompt("新しいリスト名を入力してください");
  if (!name || !name.trim()) return;
  const list = { id: makeListId(), name: name.trim(), icon: "folder" };
  state.lists.push(list);
  currentListId = list.id;
  saveState();
  render();
});

// ===================== タスク取得・フィルタ =====================
function getVisibleTasks() {
  const today = todayStr();
  let tasks = state.tasks.slice();

  if (currentListId !== "__all__") {
    tasks = tasks.filter((t) => t.listId === currentListId);
  }

  switch (currentFilter) {
    case "today":
      tasks = tasks.filter((t) => t.due === today && !t.completed);
      break;
    case "overdue":
      tasks = tasks.filter((t) => t.due && t.due < today && !t.completed);
      break;
    case "active":
      tasks = tasks.filter((t) => !t.completed);
      break;
    case "completed":
      tasks = tasks.filter((t) => t.completed);
      break;
    default:
      break;
  }

  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    tasks = tasks.filter((t) => t.title.toLowerCase().includes(q));
  }

  tasks.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    switch (currentSort) {
      case "due":
        if (!a.due && !b.due) return 0;
        if (!a.due) return 1;
        if (!b.due) return -1;
        return a.due.localeCompare(b.due);
      case "priority":
        return priorityWeight(a.priority) - priorityWeight(b.priority);
      case "alpha":
        return a.title.localeCompare(b.title, "ja");
      default:
        return a.createdAt - b.createdAt;
    }
  });

  return tasks;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function dueTagInfo(due) {
  if (!due) return null;
  const today = todayStr();
  let cls = "";
  if (due < today) cls = "due-overdue";
  else if (due === today) cls = "due-today";
  const [y, m, d] = due.split("-");
  return { cls, label: `${m}/${d}` };
}

// ===================== 描画 =====================
function renderTasks() {
  const tasks = getVisibleTasks();
  taskListEl.innerHTML = "";

  if (tasks.length === 0) {
    emptyState.hidden = false;
    taskListEl.hidden = true;
  } else {
    emptyState.hidden = true;
    taskListEl.hidden = false;
  }

  tasks.forEach((task) => {
    taskListEl.appendChild(buildTaskItem(task));
  });
}

function buildTaskItem(task) {
  const row = document.createElement("div");
  row.className = "task-item" + (task.completed ? " completed" : "");
  row.dataset.taskId = task.id;

  const listInfo = state.lists.find((l) => l.id === task.listId);
  const due = dueTagInfo(task.due);

  row.innerHTML = `
    <input type="checkbox" class="task-checkbox" ${task.completed ? "checked" : ""} />
    <div class="task-body">
      <div class="task-title">${escapeHtml(task.title)}</div>
      <div class="task-meta">
        ${currentListId === "__all__" && listInfo ? `<span class="task-tag task-list-badge"><span class="material-symbols-outlined">folder</span>${escapeHtml(listInfo.name)}</span>` : ""}
        ${due ? `<span class="task-tag ${due.cls}"><span class="material-symbols-outlined">event</span>${due.label}</span>` : ""}
        <span class="task-tag priority-${task.priority}">優先度: ${priorityLabel(task.priority)}</span>
      </div>
    </div>
    <button class="task-delete" title="削除">
      <span class="material-symbols-outlined">delete</span>
    </button>
  `;

  const checkbox = row.querySelector(".task-checkbox");
  checkbox.addEventListener("click", (e) => e.stopPropagation());
  checkbox.addEventListener("change", () => {
    task.completed = checkbox.checked;
    task.completedAt = task.completed ? Date.now() : null;
    saveState();
    render();
  });

  const deleteBtn = row.querySelector(".task-delete");
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    state.tasks = state.tasks.filter((t) => t.id !== task.id);
    saveState();
    render();
  });

  row.addEventListener("click", () => openEditPanel(task.id));

  return row;
}

function renderCounts() {
  const today = todayStr();
  const scoped = currentListId === "__all__" ? state.tasks : state.tasks.filter((t) => t.listId === currentListId);

  countAll.textContent = scoped.length;
  countToday.textContent = scoped.filter((t) => t.due === today && !t.completed).length;
  countOverdue.textContent = scoped.filter((t) => t.due && t.due < today && !t.completed).length;
  countActive.textContent = scoped.filter((t) => !t.completed).length;
  countCompleted.textContent = scoped.filter((t) => t.completed).length;

  totalCountEl.textContent = scoped.length;
  doneCountEl.textContent = scoped.filter((t) => t.completed).length;
  remainingCountEl.textContent = scoped.filter((t) => !t.completed).length;

  const listName =
    currentListId === "__all__"
      ? "すべて"
      : state.lists.find((l) => l.id === currentListId)?.name || "すべて";
  currentListLabel.textContent = listName;
}

function render() {
  renderListNav();
  renderTasks();
  renderCounts();

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.filter === currentFilter);
  });
}

// ===================== タスク追加 =====================
function addTask({ title, listId, due, priority }) {
  const task = {
    id: makeTaskId(),
    title: title.trim(),
    listId: listId || state.lists[0].id,
    due: due || null,
    priority: priority || "mid",
    completed: false,
    createdAt: Date.now(),
    completedAt: null,
  };
  state.tasks.push(task);
  saveState();
  render();
}

function openCompose() {
  closeEditPanel();
  composePanel.hidden = false;
  findPanel.hidden = true;
  if (currentListId !== "__all__") {
    composeList.value = currentListId;
  }
  composeTitle.focus();
}

function closeCompose() {
  composePanel.hidden = true;
  composeTitle.value = "";
  composeDue.value = "";
  composePriority.value = "mid";
}

newTaskBtn.addEventListener("click", () => {
  if (!composePanel.hidden) {
    closeCompose();
  } else {
    openCompose();
  }
});

composeCloseBtn.addEventListener("click", closeCompose);

function submitCompose() {
  const title = composeTitle.value.trim();
  if (!title) {
    composeTitle.focus();
    return;
  }
  addTask({
    title,
    listId: composeList.value,
    due: composeDue.value,
    priority: composePriority.value,
  });
  composeTitle.value = "";
  composeTitle.focus();
  setStatus("タスクを追加しました");
}

composeAddBtn.addEventListener("click", submitCompose);
composeTitle.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    submitCompose();
  }
  if (e.key === "Escape") {
    closeCompose();
  }
});

// ===================== タスク編集 =====================
function openEditPanel(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  editingTaskId = taskId;
  closeCompose();
  findPanel.hidden = true;
  populateListSelect(editList, task.listId);
  editList.value = task.listId;
  editTitle.value = task.title;
  editDue.value = task.due || "";
  editPriority.value = task.priority;
  editPanel.hidden = false;
  editTitle.focus();
}

function closeEditPanel() {
  editPanel.hidden = true;
  editingTaskId = null;
}

function saveEdit() {
  const task = state.tasks.find((t) => t.id === editingTaskId);
  if (!task) return;
  const title = editTitle.value.trim();
  if (!title) {
    editTitle.focus();
    return;
  }
  task.title = title;
  task.listId = editList.value;
  task.due = editDue.value || null;
  task.priority = editPriority.value;
  saveState();
  closeEditPanel();
  render();
  setStatus("タスクを更新しました");
}

editSaveBtn.addEventListener("click", saveEdit);
editTitle.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    saveEdit();
  }
  if (e.key === "Escape") {
    closeEditPanel();
  }
});

editDeleteBtn.addEventListener("click", () => {
  const task = state.tasks.find((t) => t.id === editingTaskId);
  if (!task) return;
  if (!confirm(`タスク「${task.title}」を削除しますか?`)) return;
  state.tasks = state.tasks.filter((t) => t.id !== editingTaskId);
  saveState();
  closeEditPanel();
  render();
  setStatus("タスクを削除しました");
});

editCloseBtn.addEventListener("click", closeEditPanel);

// ===================== 検索 =====================
findBtn.addEventListener("click", () => {
  if (!findPanel.hidden) {
    findPanel.hidden = true;
    searchQuery = "";
    render();
  } else {
    findPanel.hidden = false;
    closeCompose();
    closeEditPanel();
    findInput.focus();
  }
});

findInput.addEventListener("input", () => {
  searchQuery = findInput.value;
  renderTasks();
  const count = getVisibleTasks().length;
  findCount.textContent = searchQuery ? `${count} 件` : "";
});

findCloseBtn.addEventListener("click", () => {
  findPanel.hidden = true;
  searchQuery = "";
  findInput.value = "";
  findCount.textContent = "";
  render();
});

// ===================== 並び替えメニュー =====================
sortBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  sortMenu.hidden = !sortMenu.hidden;
});

sortMenu.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-sort]");
  if (!btn) return;
  currentSort = btn.dataset.sort;
  sortMenu.querySelectorAll(".menu-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.sort === currentSort);
  });
  sortMenu.hidden = true;
  renderTasks();
});

document.addEventListener("click", (e) => {
  if (!sortBtn.contains(e.target) && !sortMenu.contains(e.target)) {
    sortMenu.hidden = true;
  }
});

// ===================== タブ(フィルタ) =====================
tabbar.addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  currentFilter = tab.dataset.filter;
  render();
});

// ===================== 完了済み削除 =====================
clearCompletedBtn.addEventListener("click", () => {
  const scoped = currentListId === "__all__";
  const target = state.tasks.filter((t) => t.completed && (scoped || t.listId === currentListId));
  if (target.length === 0) {
    setStatus("完了済みのタスクはありません");
    return;
  }
  if (!confirm(`完了済みタスクを ${target.length} 件削除しますか?`)) return;
  const targetIds = new Set(target.map((t) => t.id));
  state.tasks = state.tasks.filter((t) => !targetIds.has(t.id));
  saveState();
  render();
  setStatus("完了済みタスクを削除しました");
});

// ===================== テーマ =====================
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") {
    document.documentElement.setAttribute("data-theme", saved);
  }
}

function currentEffectiveTheme() {
  const stamped = document.documentElement.getAttribute("data-theme");
  if (stamped) return stamped;
  const systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return systemDark ? "dark" : "light";
}

themeBtn.addEventListener("click", () => {
  const next = currentEffectiveTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(THEME_KEY, next);
});

// ===================== キーボードショートカット =====================
document.addEventListener("keydown", (e) => {
  const isMod = e.ctrlKey || e.metaKey;
  if (isMod && e.key.toLowerCase() === "n") {
    e.preventDefault();
    openCompose();
  }
  if (isMod && e.key.toLowerCase() === "f") {
    e.preventDefault();
    findPanel.hidden = false;
    closeCompose();
    closeEditPanel();
    findInput.focus();
  }
  if (e.key === "Escape") {
    if (!composePanel.hidden) closeCompose();
    if (!editPanel.hidden) closeEditPanel();
    if (!findPanel.hidden) {
      findPanel.hidden = true;
      searchQuery = "";
      findInput.value = "";
      render();
    }
  }
});

// ===================== 初期化 =====================
function seedIfEmpty() {
  if (state.tasks.length > 0) return;
  const inboxId = state.lists[0].id;
  const today = todayStr();
  state.tasks.push(
    {
      id: makeTaskId(),
      title: "Tasklineへようこそ。このタスクを完了してみましょう",
      listId: inboxId,
      due: today,
      priority: "mid",
      completed: false,
      createdAt: Date.now() - 3000,
      completedAt: null,
    },
    {
      id: makeTaskId(),
      title: "左のリストからタスクを追加・整理できます",
      listId: inboxId,
      due: null,
      priority: "low",
      completed: false,
      createdAt: Date.now() - 2000,
      completedAt: null,
    },
    {
      id: makeTaskId(),
      title: "右上の「新規タスク」で期限や優先度を設定できます",
      listId: inboxId,
      due: null,
      priority: "high",
      completed: false,
      createdAt: Date.now() - 1000,
      completedAt: null,
    }
  );
}

seedIfEmpty();
initTheme();
render();
setStatus("準備完了");
