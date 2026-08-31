const supabaseConfig = window.SCHOOL_SUPABASE_CONFIG;
const supabaseClient = supabaseConfig?.url && supabaseConfig?.publishableKey && window.supabase
  ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.publishableKey)
  : null;
let cloudStateId = "";
let cloudReady = false;
let cloudSaveTimer = null;
let currentProfile = null;

const weekdays = {
  1: "Понедельник",
  2: "Вторник",
  3: "Среда",
  4: "Четверг",
  5: "Пятница",
  6: "Суббота",
  0: "Воскресенье"
};

const workWeekdays = [1, 2, 3, 4, 5, 6];
const lessonTypes = ["Специальность", "Ансамбль", "Оркестр", "Хор", "Сольфеджио", "Концертмейстер"];
const educationForms = ["ДПП", "ДОП"];
const dopSubjectName = "Музыкальные инструменты";

const holidaySeed = [
  ["2026-10-29", "Осенние каникулы"],
  ["2026-10-30", "Осенние каникулы"],
  ["2026-10-31", "Осенние каникулы"],
  ["2026-11-01", "Осенние каникулы"],
  ["2026-11-02", "Осенние каникулы"],
  ["2026-11-03", "Осенние каникулы"],
  ["2026-11-04", "Осенние каникулы"],
  ["2026-12-29", "Зимние каникулы"],
  ["2026-12-30", "Зимние каникулы"],
  ["2026-12-31", "Зимние каникулы"],
  ["2027-01-01", "Зимние каникулы"],
  ["2027-01-02", "Зимние каникулы"],
  ["2027-01-03", "Зимние каникулы"],
  ["2027-01-04", "Зимние каникулы"],
  ["2027-01-05", "Зимние каникулы"],
  ["2027-01-06", "Зимние каникулы"],
  ["2027-01-07", "Зимние каникулы"],
  ["2027-01-08", "Зимние каникулы"],
  ["2027-01-09", "Зимние каникулы"],
  ["2027-01-10", "Зимние каникулы"],
  ["2027-02-23", "День защитника Отечества"],
  ["2027-03-08", "Международный женский день"],
  ["2027-03-24", "Весенние каникулы"],
  ["2027-03-25", "Весенние каникулы"],
  ["2027-03-26", "Весенние каникулы"],
  ["2027-03-27", "Весенние каникулы"],
  ["2027-03-28", "Весенние каникулы"],
  ["2027-03-29", "Весенние каникулы"],
  ["2027-03-30", "Весенние каникулы"],
  ["2027-03-31", "Весенние каникулы"],
  ["2027-05-01", "Праздник Весны и Труда"],
  ["2027-05-10", "День Победы"]
];

let state = createDemoData();
const peoplePages = { students: 1, groups: 1, employees: 1 };
const peoplePageSize = 12;
let activeScheduleWeekday = 1;
let showScheduleArchive = false;

const tabs = document.querySelectorAll(".nav-tab");
const pageTitle = document.querySelector("#pageTitle");
const views = {
  dashboard: document.querySelector("#dashboardView"),
  schedule: document.querySelector("#scheduleView"),
  journal: document.querySelector("#journalView"),
  people: document.querySelector("#peopleView"),
  calendar: document.querySelector("#calendarView")
};
const titles = {
  dashboard: "Кабинет преподавателя",
  schedule: "Расписание",
  journal: "Журнал занятий",
  people: "Списки учеников и сотрудников",
  calendar: "Учебный план"
};

tabs.forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));
document.querySelector("#loginForm").addEventListener("submit", login);
document.querySelector("#modalClose").addEventListener("click", closeModal);
document.querySelector("#modalOverlay").addEventListener("click", (event) => {
  if (event.target.id === "modalOverlay") closeModal();
});
document.querySelector("#activeEmployee").addEventListener("change", (event) => {
  if (!isAdmin()) return;
  state.activeEmployeeId = event.target.value;
  persistAndRender();
});
document.querySelector("#logoutButton").addEventListener("click", logout);
document.querySelector("#exportData").addEventListener("click", exportSchoolData);
document.querySelector("#importData").addEventListener("click", () => {
  if (isAdmin()) document.querySelector("#dataImportFile").click();
});
document.querySelector("#dataImportFile").addEventListener("change", importSchoolData);
["#studentSearch", "#employeeSearch"].forEach((selector) => {
  document.querySelector(selector)?.addEventListener("input", () => {
    resetPeoplePages();
    renderPeople();
  });
});
["#peopleTeacherFilter", "#studentInstrumentFilter", "#employeeInstrumentFilter"].forEach((selector) => {
  document.querySelector(selector)?.addEventListener("change", () => {
    resetPeoplePages();
    renderPeople();
  });
});

document.querySelector("#studentForm").addEventListener("submit", addStudent);
document.querySelector("#employeeForm").addEventListener("submit", addEmployee);
document.querySelector("#holidayForm").addEventListener("submit", addHoliday);
document.querySelector("#generateJournal").addEventListener("click", generateSelectedMonth);
document.querySelector("#printJournal").addEventListener("click", () => window.print());
document.querySelector("#journalMonth").addEventListener("change", () => {
  const month = document.querySelector("#journalMonth").value;
  document.querySelector("#generateAsOf").value = `${month}-25`;
  render();
});
document.addEventListener("click", (event) => {
  const removeStudent = event.target.closest("[data-student-picker-remove]");
  if (removeStudent) {
    removeStudentFromPicker(removeStudent);
    return;
  }

  const action = event.target.closest("[data-action]");
  if (!action) return;

  const [name, id] = action.dataset.action.split(":");
  if (name === "closeSchedule") closeScheduleRow(id);
  if (name === "scheduleDay") setActiveScheduleDay(Number(id));
  if (name === "addScheduleDay") openScheduleModal(Number(id));
  if (name === "deleteSchedule") deleteScheduleRow(id);
  if (name === "archiveSchedule") openArchiveScheduleModal();
  if (name === "toggleScheduleArchive") toggleScheduleArchive();
  if (name === "printSchedule") printSchedule();
  if (name === "deleteStudent") deleteStudent(id);
  if (name === "deleteEmployee") deleteEmployee(id);
  if (name === "deleteHoliday") deleteHoliday(id);
  if (name === "openStudentModal") openStudentModal();
  if (name === "openEmployeeModal") openEmployeeModal();
  if (name === "openGroupModal") openGroupModal();
  if (name === "assignStudent") openAssignStudentModal(id);
  if (name === "assignGroup") openAssignGroupModal(id);
  if (name === "deleteGroup") deleteGroup(id);
  if (name === "peoplePage") setPeoplePage(id);
  if (name === "openHolidayModal") openHolidayModal("");
  if (name === "openHolidayDate") openHolidayModal(id);
});

document.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-modal-form]");
  if (!form) return;
  event.preventDefault();

  const type = form.dataset.modalForm;
  if (type === "student") addStudentFromModal(form);
  if (type === "employee") addEmployeeFromModal(form);
  if (type === "group") addGroupFromModal(form);
  if (type === "assignStudent") assignStudentFromModal(form);
  if (type === "assignGroup") assignGroupFromModal(form);
  if (type === "holiday") addHolidayFromModal(form);
  if (type === "schedule") addScheduleFromModal(form);
  if (type === "archiveSchedule") archiveCurrentSchedule(form);
});

document.addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-drag-participant]");
  if (!card) return;
  event.dataTransfer.setData("text/plain", card.dataset.dragParticipant);
  event.dataTransfer.effectAllowed = "copy";
});

document.addEventListener("dragover", (event) => {
  const dropZone = event.target.closest("[data-schedule-drop]");
  if (!dropZone) return;
  event.preventDefault();
  dropZone.classList.add("drag-over");
});

document.addEventListener("dragleave", (event) => {
  const dropZone = event.target.closest("[data-schedule-drop]");
  if (dropZone) dropZone.classList.remove("drag-over");
});

document.addEventListener("drop", (event) => {
  const dropZone = event.target.closest("[data-schedule-drop]");
  if (!dropZone) return;
  event.preventDefault();
  dropZone.classList.remove("drag-over");
  const participantId = event.dataTransfer.getData("text/plain");
  addScheduleFromParticipant(participantId, Number(dropZone.dataset.scheduleDrop || activeScheduleWeekday));
});

document.addEventListener("change", (event) => {
  const pickerCheckbox = event.target.closest("[data-student-picker-choice]");
  if (pickerCheckbox) {
    setStudentPickerSelection(pickerCheckbox);
    return;
  }

  const select = event.target.closest("[data-grade-record]");
  if (select) {
    setGrade(select.dataset.gradeRecord, select.value);
    return;
  }

  const modalParticipant = event.target.closest("[data-modal-participant]");
  if (modalParticipant) {
    const participant = participantById(modalParticipant.value);
    const classInput = document.querySelector("[data-modal-class]");
    if (classInput) classInput.value = participant?.className || "";
    return;
  }

  const scheduleField = event.target.closest("[data-schedule-field]");
  if (scheduleField) updateScheduleField(scheduleField);
});

document.addEventListener("input", (event) => {
  const studentSearch = event.target.closest("[data-student-picker-search]");
  if (studentSearch) {
    renderStudentPickerResults(studentSearch.closest("[data-student-picker]"));
    return;
  }

  const timePart = event.target.closest("[data-time-part]");
  if (timePart) {
    handleTimeInput(timePart);
    return;
  }

  const numericInput = event.target.closest("[data-numeric-input]");
  if (numericInput) {
    numericInput.value = digitsOnly(numericInput.value);
  }
});

document.addEventListener("focusout", (event) => {
  const timePart = event.target.closest("[data-time-part]");
  if (timePart) commitScheduleTime(timePart, true);

  const numericInput = event.target.closest("[data-numeric-input]");
  if (numericInput) updateScheduleField(numericInput);
});

document.addEventListener("beforeinput", (event) => {
  const numericTarget = event.target.closest("[data-time-part], [data-numeric-input]");
  if (!numericTarget || !event.data) return;
  if (/\D/.test(event.data)) event.preventDefault();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const scheduleInput = event.target.closest(".schedule-table input, .schedule-table select");
  if (!scheduleInput) return;

  event.preventDefault();
  applyScheduleInput(scheduleInput);
  focusNextScheduleInput(scheduleInput);
});

function createDemoData() {
  return {
    sessionEmployeeId: "",
    activeEmployeeId: "",
    employees: [],
    students: [],
    groups: [],
    schedule: [],
    records: [],
    scheduleArchives: [],
    holidays: holidaySeed.map(([date, name]) => ({ id: crypto.randomUUID(), date, name })),
    academicPlanVersion: "2026-2027-v2"
  };
}

function uniqueByIdValues(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function migrateState(source) {
  const data = source && typeof source === "object" ? structuredClone(source) : createDemoData();
  data.sessionEmployeeId = "";
  data.activeEmployeeId = data.activeEmployeeId || "";
  data.employees = Array.isArray(data.employees) ? data.employees : [];
  data.students = Array.isArray(data.students) ? data.students : [];
  data.groups = Array.isArray(data.groups) ? data.groups : [];
  data.schedule = Array.isArray(data.schedule) ? data.schedule : [];
  data.records = Array.isArray(data.records) ? data.records : [];
  data.scheduleArchives = Array.isArray(data.scheduleArchives) ? data.scheduleArchives : [];
  data.holidays = Array.isArray(data.holidays) ? data.holidays : [];

  data.employees.forEach((employee) => {
    delete employee.password;
    employee.username = String(employee.username || "").trim();
    employee.isAdmin = Boolean(employee.isAdmin);
  });
  data.students.forEach((student, index) => {
    student.externalId = student.externalId || `S-${String(index + 1).padStart(4, "0")}`;
    student.assignedEmployeeIds = uniqueByIdValues(student.assignedEmployeeIds || []);
    student.educationForm = normalizeEducationForm(student.educationForm);
    delete student.employeeId;
  });
  data.groups.forEach((group, index) => {
    group.externalId = group.externalId || `G-${String(index + 1).padStart(4, "0")}`;
    group.studentIds = uniqueByIdValues(group.studentIds || []);
    group.assignedEmployeeIds = uniqueByIdValues(group.assignedEmployeeIds || []);
    group.educationForm = normalizeEducationForm(group.educationForm);
  });
  data.schedule.forEach((row) => {
    row.groupId = row.groupId || "";
    row.archiveId = row.archiveId || "";
    row.effectiveFrom = row.effectiveFrom || "2026-09-01";
    if (row.type === "Индивидуальный урок") row.type = "Специальность";
    row.room = digitsOnly(row.room || "");
  });
  data.records.forEach((record) => {
    if (record.type === "Индивидуальный урок") record.type = "Специальность";
    const participant = [...data.students, ...data.groups].find((item) => item.id === record.studentId);
    record.educationForm = normalizeEducationForm(record.educationForm || participant?.educationForm);
  });
  return data;
}
function persistAndRender() {
  queueCloudSave();
  render();
}

function cloudPayload() {
  const payload = structuredClone(state);
  payload.sessionEmployeeId = "";
  payload.employees.forEach((employee) => delete employee.password);
  return payload;
}

function schoolAuthEmail(username) {
  const safeUsername = String(username || "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return `${safeUsername}@journal.local`;
}

async function loadCloudState() {
  if (!supabaseClient) return false;
  const { data, error } = await supabaseClient
    .from("school_state")
    .select("id, payload")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("Supabase state load failed", error.message);
    return false;
  }

  if (data?.payload && Array.isArray(data.payload.employees)) {
    state = migrateState(data.payload);
    cloudStateId = data.id;
  } else {
    const created = await supabaseClient
      .from("school_state")
      .insert({ payload: state })
      .select("id")
      .single();
    if (created.error) {
      console.warn("Supabase initial state save failed", created.error.message);
      return false;
    }
    cloudStateId = created.data.id;
  }

  cloudReady = true;
  return true;
}

async function loadCurrentProfile(userId) {
  const { data, error } = await supabaseClient
    .from("school_profiles")
    .select("id, username, display_name, role, is_admin")
    .eq("id", userId)
    .single();
  if (error || !data) {
    console.warn("Supabase profile load failed", error?.message || "profile not found");
    return null;
  }
  return data;
}

function queueCloudSave() {
  if (!supabaseClient || !cloudReady || !cloudStateId) return;
  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(async () => {
    const { error } = await supabaseClient
      .from("school_state")
      .update({ payload: cloudPayload() })
      .eq("id", cloudStateId);
    if (error) console.warn("Supabase state save failed", error.message);
  }, 450);
}

function render() {
  renderAuthState();
  if (!currentUser()) return;
  ensureActiveEmployee();
  renderEmployeeSelect();
  renderDashboard();
  renderSchedule();
  renderJournal();
  renderPeople();
  renderHolidays();
}

function ensureActiveEmployee() {
  if (!isAdmin()) {
    state.activeEmployeeId = state.sessionEmployeeId;
    return;
  }

  if (!visibleEmployees().find((employee) => employee.id === state.activeEmployeeId)) {
    state.activeEmployeeId = visibleEmployees()[0]?.id || "";
  }
}

function renderAuthState() {
  const loggedIn = Boolean(currentUser());
  document.querySelector("#loginScreen").classList.toggle("is-hidden", loggedIn);
  document.querySelector("#appShell").classList.toggle("is-hidden", !loggedIn);
  document.querySelectorAll(".admin-data-action").forEach((button) => {
    button.classList.toggle("is-hidden", !loggedIn || !isAdmin());
  });
}

function exportSchoolData() {
  if (!isAdmin()) return;
  const payload = {
    format: "music-school-cabinet-backup-v1",
    exportedAt: new Date().toISOString(),
    state: cloudPayload()
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `journal-school-backup-${todayISO()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importSchoolData(event) {
  if (!isAdmin()) return;
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const payload = JSON.parse(String(reader.result || ""));
      const imported = payload.state || payload;
      if (!Array.isArray(imported.employees) || !Array.isArray(imported.students) || !Array.isArray(imported.schedule)) {
        throw new Error("invalid backup");
      }
      if (!confirm("Заменить текущие данные данными из резервной копии?")) return;
      state = migrateState(imported);
      state.sessionEmployeeId = currentUser()?.id || state.employees.find((employee) => employee.isAdmin)?.id || "";
      persistAndRender();
    } catch {
      alert("Не удалось прочитать резервную копию. Выберите файл экспорта журнала.");
    }
  });
  reader.readAsText(file, "UTF-8");
}

async function login(event) {
  event.preventDefault();
  const username = document.querySelector("#loginUsername").value.trim();
  const password = document.querySelector("#loginPassword").value;
  const submitButton = event.submitter || event.target.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  setLoginStatus("Проверяем данные…", "info");

  if (!supabaseClient) {
    setLoginStatus("Подключение к серверу не настроено. Обратитесь к администратору.", "error");
    submitButton.disabled = false;
    return;
  }

  const { data: authData, error } = await supabaseClient.auth.signInWithPassword({
    email: schoolAuthEmail(username),
    password
  });
  if (error || !authData.user) {
    console.warn("Supabase sign-in failed", error?.message || "user not returned");
    setLoginStatus("Неверный логин или пароль.", "error");
    submitButton.disabled = false;
    return;
  }

  currentProfile = await loadCurrentProfile(authData.user.id);
  if (!currentProfile || currentProfile.username !== username || !await loadCloudState()) {
    await supabaseClient.auth.signOut();
    currentProfile = null;
    setLoginStatus("Профиль сотрудника не настроен. Обратитесь к администратору.", "error");
    submitButton.disabled = false;
    return;
  }

  const employee = state.employees.find((item) => item.username === currentProfile.username);
  if (!employee) {
    await supabaseClient.auth.signOut();
    currentProfile = null;
    setLoginStatus("Профиль сотрудника не связан со школьной базой.", "error");
    submitButton.disabled = false;
    return;
  }

  employee.isAdmin = Boolean(currentProfile.is_admin);
  state.sessionEmployeeId = employee.id;
  state.activeEmployeeId = employee.isAdmin ? visibleEmployees()[0]?.id || employee.id : employee.id;
  event.target.reset();
  setLoginStatus("", "");
  submitButton.disabled = false;
  render();
}

async function logout() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  state = createDemoData();
  currentProfile = null;
  cloudReady = false;
  cloudStateId = "";
  render();
}

function setLoginStatus(message, kind) {
  const status = document.querySelector("#loginStatus");
  status.textContent = message;
  status.dataset.kind = kind;
}

async function initializeAuth() {
  render();
  if (!supabaseClient) {
    setLoginStatus("Подключение к серверу не настроено.", "error");
    return;
  }
  const { data } = await supabaseClient.auth.getSession();
  const user = data.session?.user;
  if (!user) return;
  currentProfile = await loadCurrentProfile(user.id);
  if (!currentProfile || !await loadCloudState()) {
    await supabaseClient.auth.signOut();
    currentProfile = null;
    return;
  }
  const employee = state.employees.find((item) => item.username === currentProfile.username);
  if (!employee) {
    await supabaseClient.auth.signOut();
    currentProfile = null;
    state = createDemoData();
    return;
  }
  employee.isAdmin = Boolean(currentProfile.is_admin);
  state.sessionEmployeeId = employee.id;
  state.activeEmployeeId = employee.isAdmin ? visibleEmployees()[0]?.id || employee.id : employee.id;
  render();
}

function switchTab(name) {
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  Object.entries(views).forEach(([viewName, view]) => view.classList.toggle("active", viewName === name));
  pageTitle.textContent = titles[name];
}

function openModal(title, body) {
  document.querySelector("#modalContent").innerHTML = `
    <div class="form-header">
      <h3>${title}</h3>
    </div>
    ${body}
  `;
  document.querySelector("#modalOverlay").classList.remove("is-hidden");
  document.body.classList.add("modal-open");
}

function closeModal() {
  document.querySelector("#modalOverlay").classList.add("is-hidden");
  document.querySelector("#modalContent").innerHTML = "";
  document.body.classList.remove("modal-open");
}

function openStudentModal() {
  if (!isAdmin()) return;
  openModal("Добавить ученика или группу", `
    <form class="modal-form" data-modal-form="student">
      <label>Название<input type="text" name="name" placeholder="Фамилия Имя или Оркестр" required /></label>
      <label>Класс<input type="text" name="className" placeholder="5/8, анс, оркестр" /></label>
      <label>Форма обучения<select name="educationForm">${educationFormOptions("ДПП")}</select></label>
      <label>ID<input type="text" name="externalId" placeholder="автоматически, если оставить пустым" /></label>
      <button class="primary-button" type="submit">Добавить</button>
    </form>
  `);
}

function openGroupModal() {
  if (!isAdmin()) return;
  openModal("Создать группу", `
    <form class="modal-form" data-modal-form="group">
      <label>Название группы<input type="text" name="name" placeholder="Ансамбль 5 класс" required /></label>
      <label>ID группы<input type="text" name="externalId" placeholder="автоматически, если оставить пустым" /></label>
      <label>Класс / пометка<input type="text" name="className" placeholder="анс" /></label>
      <label>Форма обучения<select name="educationForm">${educationFormOptions("ДПП")}</select></label>
      ${studentPicker([])}
      <button class="primary-button" type="submit">Создать группу</button>
    </form>
  `);
}

function openAssignStudentModal(studentId) {
  if (!isAdmin()) return;
  const student = state.students.find((item) => item.id === studentId);
  if (!student) return;
  openModal(`Назначить ученика: ${escapeHtml(student.name)}`, `
    <form class="modal-form" data-modal-form="assignStudent" data-student-id="${student.id}">
      <label>Форма обучения<select name="educationForm">${educationFormOptions(student.educationForm)}</select></label>
      <div class="check-list">
        ${teacherCheckboxes(student.assignedEmployeeIds || [])}
      </div>
      <button class="primary-button" type="submit">Сохранить</button>
    </form>
  `);
}

function openAssignGroupModal(groupId) {
  if (!isAdmin()) return;
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) return;
  openModal(`Настройка группы: ${escapeHtml(group.name)}`, `
    <form class="modal-form" data-modal-form="assignGroup" data-group-id="${group.id}">
      <label>Форма обучения<select name="educationForm">${educationFormOptions(group.educationForm)}</select></label>
      <div class="assignment-grid">
        <section>
          <h4>Ученики в группе</h4>
          ${studentPicker(group.studentIds || [])}
        </section>
        <section>
          <h4>Преподаватели группы</h4>
          <div class="check-list">
            ${teacherCheckboxes(group.assignedEmployeeIds || [])}
          </div>
        </section>
      </div>
      <button class="primary-button" type="submit">Сохранить</button>
    </form>
  `);
}

function openEmployeeModal() {
  if (!isAdmin()) return;
  openModal("Добавить сотрудника", `
    <form class="modal-form" data-modal-form="employee">
      <p class="muted-note">Сначала создайте пользователя с адресом <strong>логин@journal.local</strong> в Supabase Authentication и профиль с тем же логином.</p>
      <label>ФИО<input type="text" name="name" placeholder="Иванова Анна Сергеевна" required /></label>
      <label>Должность / предмет<input type="text" name="role" placeholder="Преподаватель" required /></label>
      <label>Логин<input type="text" name="username" placeholder="ivanova" required /></label>
      <label class="checkbox-label"><input type="checkbox" name="isAdmin" />Администратор</label>
      <button class="primary-button" type="submit">Добавить</button>
    </form>
  `);
}

function openHolidayModal(date) {
  if (!isAdmin()) return;
  openModal("Добавить дату учебного плана", `
    <form class="modal-form" data-modal-form="holiday">
      <label>Дата<input type="date" name="date" value="${date || ""}" required /></label>
      <label>Название<input type="text" name="name" value="Каникулы / неучебный день" required /></label>
      <button class="primary-button" type="submit">Добавить дату</button>
    </form>
  `);
}

function openScheduleModal(weekday) {
  const participant = visibleParticipants()[0];
  if (!participant) {
    alert("Сначала администратор должен назначить ученика или группу преподавателю.");
    return;
  }

  openModal(`Добавить занятие: ${weekdays[weekday]}`, `
    <form class="modal-form schedule-modal-form" data-modal-form="schedule" data-weekday="${weekday}">
      <label>Время<input type="text" name="time" placeholder="14.45-15.25" required /></label>
      <label>Ученик / группа<select name="studentId" data-modal-participant>${participantOptions(participant.id)}</select></label>
      <label>Вид<select name="type">${lessonTypeOptions("Специальность")}</select></label>
      <label>Класс<input type="text" name="className" value="${escapeAttr(participant.className || "")}" data-modal-class readonly /></label>
      <label>Пед. часы<input type="text" inputmode="numeric" name="pedHours" value="1" data-numeric-input required /></label>
      <label>Конц. часы<input type="text" inputmode="numeric" name="kcHours" value="0" data-numeric-input required /></label>
      <label>Кабинет<input type="text" inputmode="numeric" name="room" placeholder="18" data-numeric-input /></label>
      <button class="primary-button" type="submit">Добавить</button>
    </form>
  `);
}

function addScheduleRow(weekday) {
  const participant = visibleParticipants()[0];
  if (!participant) {
    alert("Сначала администратор должен назначить ученика или группу преподавателю.");
    return;
  }

  state.schedule.push({
    id: crypto.randomUUID(),
    employeeId: state.activeEmployeeId,
    effectiveFrom: currentScheduleEffectiveFrom(),
    effectiveTo: "",
    archiveId: "",
    weekday,
    time: "",
    studentId: participant.id,
    groupId: "",
    className: participant.className || "",
    type: participant.kind === "group" && participant.name === "Оркестр" ? "Оркестр" : "Специальность",
    pedHours: 1,
    kcHours: 0,
    room: ""
  });
  persistAndRender();
}

function updateScheduleField(field) {
  const row = state.schedule.find((item) => item.id === field.dataset.scheduleId);
  if (!row) return;

  const key = field.dataset.scheduleField;
  if (key === "studentId") {
    row.studentId = field.value;
    const participant = participantById(field.value);
    row.className = participant?.className || row.className;
    if (participant?.kind === "group" && participant.name === "Оркестр") row.type = "Оркестр";
  } else if (key === "pedHours" || key === "kcHours" || key === "weekday") {
    row[key] = Number(digitsOnly(field.value) || 0);
  } else if (key === "room") {
    row[key] = digitsOnly(field.value);
  } else {
    row[key] = field.value.trim();
    if (key === "type") updateHoursFromTime(row);
  }

  persistAndRender();
}

function handleTimeInput(input) {
  input.value = digitsOnly(input.value).slice(0, 2);
  const part = input.dataset.timePart;

  if (part === "hours") {
    if (Number(input.value) > 24) input.value = "24";
    if (input.value.length === 2 || (input.value.length === 1 && !["1", "2"].includes(input.value))) {
      const minutesInput = input.closest(".time-pair")?.querySelector(`[data-time-bound="${input.dataset.timeBound}"][data-time-part="minutes"]`);
      minutesInput?.focus();
      minutesInput?.select();
    }
  }

  if (part === "minutes" && input.value.length > 2) {
    input.value = input.value.slice(0, 2);
  }
  if (part === "minutes" && Number(input.value) > 59) input.value = "59";

  commitScheduleTime(input, false);
}

function commitScheduleTime(input, normalizeMinutes) {
  const row = state.schedule.find((item) => item.id === input.dataset.scheduleId);
  const wrapper = input.closest(".time-pair");
  if (!row || !wrapper) return;

  const startHoursInput = wrapper.querySelector('[data-time-bound="start"][data-time-part="hours"]');
  const startMinutesInput = wrapper.querySelector('[data-time-bound="start"][data-time-part="minutes"]');
  const endHoursInput = wrapper.querySelector('[data-time-bound="end"][data-time-part="hours"]');
  const endMinutesInput = wrapper.querySelector('[data-time-bound="end"][data-time-part="minutes"]');
  [startHoursInput, startMinutesInput, endHoursInput, endMinutesInput].forEach((item) => {
    item.value = digitsOnly(item.value).slice(0, 2);
  });

  if (normalizeMinutes) {
    [startMinutesInput, endMinutesInput].forEach((item) => {
      if (item.value.length === 1) item.value = `0${item.value}`;
    });
    [startHoursInput, endHoursInput].forEach((item) => {
      if (item.value.length === 1) item.value = `0${item.value}`;
    });
  }

  const start = startHoursInput.value ? `${startHoursInput.value}:${startMinutesInput.value || (normalizeMinutes ? "00" : "")}` : "";
  const end = endHoursInput.value ? `${endHoursInput.value}:${endMinutesInput.value || (normalizeMinutes ? "00" : "")}` : "";
  row.time = start && end ? `${start}-${end}` : start;
  updateHoursFromTime(row);
  refreshCalculatedHourInputs(wrapper, row);
  reorderScheduleRows(wrapper.closest("tbody"));
  queueCloudSave();
}

function reorderScheduleRows(tbody) {
  if (!tbody) return;

  const rows = [...tbody.querySelectorAll("tr[data-schedule-row]")];
  rows.sort((a, b) => {
    const first = state.schedule.find((item) => item.id === a.dataset.scheduleRow);
    const second = state.schedule.find((item) => item.id === b.dataset.scheduleRow);
    return first && second ? compareSchedule(first, second) : 0;
  });
  rows.forEach((row) => tbody.appendChild(row));
}

function applyScheduleInput(input) {
  if (input.matches("[data-time-part]")) {
    commitScheduleTime(input, true);
    return;
  }

  if (input.matches("[data-numeric-input]")) {
    input.value = digitsOnly(input.value);
  }

  if (input.matches("[data-schedule-field]") && !input.readOnly) {
    updateScheduleField(input);
  }
}

function focusNextScheduleInput(input) {
  const row = input.closest("tr");
  if (!row) return;

  const fields = [...row.querySelectorAll("input, select, button")]
    .filter((item) => !item.disabled && item.tabIndex !== -1 && !item.readOnly);
  const index = fields.indexOf(input);
  const next = fields[index + 1] || fields[0];
  next?.focus();
  if (next?.select) next.select();
}

function refreshCalculatedHourInputs(wrapper, row) {
  const tableRow = wrapper.closest("tr");
  if (!tableRow) return;
  const pedInput = tableRow.querySelector('[data-schedule-field="pedHours"]');
  const kcInput = tableRow.querySelector('[data-schedule-field="kcHours"]');
  if (pedInput) pedInput.value = row.pedHours;
  if (kcInput) kcInput.value = row.kcHours;
}

function addStudent(event) {
  event.preventDefault();
  if (!isAdmin()) return;
  state.students.push({
    id: crypto.randomUUID(),
    name: document.querySelector("#studentName").value.trim(),
    className: document.querySelector("#studentClass").value.trim(),
    externalId: nextStudentExternalId(),
    educationForm: "ДПП",
    assignedEmployeeIds: []
  });
  event.target.reset();
  persistAndRender();
}

function addStudentFromModal(form) {
  if (!isAdmin()) return;
  const externalId = form.elements.externalId.value.trim() || nextStudentExternalId();
  if (state.students.some((student) => student.externalId === externalId)) {
    alert("Ученик с таким ID уже есть.");
    return;
  }

  state.students.push({
    id: crypto.randomUUID(),
    externalId,
    name: form.elements.name.value.trim(),
    className: form.elements.className.value.trim(),
    educationForm: normalizeEducationForm(form.elements.educationForm.value),
    assignedEmployeeIds: []
  });
  closeModal();
  persistAndRender();
}

function addGroupFromModal(form) {
  if (!isAdmin()) return;
  const externalId = form.elements.externalId.value.trim() || nextGroupExternalId();
  if (state.groups.some((group) => group.externalId === externalId)) {
    alert("Группа с таким ID уже есть.");
    return;
  }

  state.groups.push({
    id: crypto.randomUUID(),
    externalId,
    name: form.elements.name.value.trim(),
    className: form.elements.className.value.trim() || "группа",
    educationForm: normalizeEducationForm(form.elements.educationForm.value),
    studentIds: selectedStudentIdsFromForm(form),
    assignedEmployeeIds: []
  });
  closeModal();
  persistAndRender();
}

function assignStudentFromModal(form) {
  const student = state.students.find((item) => item.id === form.dataset.studentId);
  if (!student) return;
  student.educationForm = normalizeEducationForm(form.elements.educationForm.value);
  state.records.filter((record) => record.studentId === student.id).forEach((record) => {
    record.educationForm = student.educationForm;
  });
  student.assignedEmployeeIds = checkedValues(form, "employeeIds");
  closeModal();
  persistAndRender();
}

function assignGroupFromModal(form) {
  const group = state.groups.find((item) => item.id === form.dataset.groupId);
  if (!group) return;
  group.educationForm = normalizeEducationForm(form.elements.educationForm.value);
  state.records.filter((record) => record.studentId === group.id).forEach((record) => {
    record.educationForm = group.educationForm;
  });
  group.studentIds = selectedStudentIdsFromForm(form);
  group.assignedEmployeeIds = checkedValues(form, "employeeIds");
  closeModal();
  persistAndRender();
}

function addEmployee(event) {
  event.preventDefault();
  if (!isAdmin()) {
    alert("Добавлять сотрудников может только администратор.");
    return;
  }

  const username = document.querySelector("#employeeUsername").value.trim();
  if (state.employees.some((employee) => employee.username === username)) {
    alert("Такой логин уже используется.");
    return;
  }

  const employee = {
    id: crypto.randomUUID(),
    name: document.querySelector("#employeeName").value.trim(),
    role: document.querySelector("#employeeRole").value.trim(),
    username,
    isAdmin: document.querySelector("#employeeIsAdmin").checked
  };
  state.employees.push(employee);
  if (!employee.isAdmin) state.activeEmployeeId = employee.id;
  event.target.reset();
  persistAndRender();
}

function addEmployeeFromModal(form) {
  if (!isAdmin()) return;
  const username = form.elements.username.value.trim();
  if (state.employees.some((employee) => employee.username === username)) {
    alert("Такой логин уже используется.");
    return;
  }

  const employee = {
    id: crypto.randomUUID(),
    name: form.elements.name.value.trim(),
    role: form.elements.role.value.trim(),
    username,
    isAdmin: form.elements.isAdmin.checked
  };
  state.employees.push(employee);
  if (!employee.isAdmin) state.activeEmployeeId = employee.id;
  closeModal();
  persistAndRender();
}

function addHoliday(event) {
  event.preventDefault();
  if (!isAdmin()) return;
  state.holidays.push({
    id: crypto.randomUUID(),
    date: document.querySelector("#holidayDate").value,
    name: document.querySelector("#holidayName").value.trim()
  });
  event.target.reset();
  persistAndRender();
}

function addHolidayFromModal(form) {
  if (!isAdmin()) return;
  const date = form.elements.date.value;
  const existing = state.holidays.find((holiday) => holiday.date === date);
  if (existing) {
    existing.name = form.elements.name.value.trim();
  } else {
    state.holidays.push({
      id: crypto.randomUUID(),
      date,
      name: form.elements.name.value.trim()
    });
  }
  closeModal();
  persistAndRender();
}

function addScheduleFromModal(form) {
  const participant = participantById(form.elements.studentId.value);
  if (!participant) return;

  state.schedule.push({
    id: crypto.randomUUID(),
    employeeId: state.activeEmployeeId,
    effectiveFrom: currentScheduleEffectiveFrom(),
    effectiveTo: "",
    archiveId: "",
    weekday: Number(form.dataset.weekday),
    time: form.elements.time.value.trim(),
    studentId: form.elements.studentId.value,
    groupId: "",
    className: participant.className || "",
    type: form.elements.type.value,
    pedHours: Number(digitsOnly(form.elements.pedHours.value) || 0),
    kcHours: Number(digitsOnly(form.elements.kcHours.value) || 0),
    room: digitsOnly(form.elements.room.value)
  });
  closeModal();
  persistAndRender();
}

function closeScheduleRow(id) {
  const row = state.schedule.find((item) => item.id === id);
  if (!row) return;
  row.effectiveTo = row.effectiveTo || todayISO();
  persistAndRender();
}

function deleteScheduleRow(id) {
  const hasRecords = state.records.some((record) => record.scheduleId === id);
  if (hasRecords && !confirm("По этой строке уже есть записи журнала. Удалить только строку расписания? Журнал сохранится.")) {
    return;
  }
  state.schedule = state.schedule.filter((item) => item.id !== id);
  persistAndRender();
}

function deleteById(collection, id) {
  state[collection] = state[collection].filter((item) => item.id !== id);
  persistAndRender();
}

function openArchiveScheduleModal() {
  const rows = employeeSchedule();
  if (!rows.length) {
    alert("В текущем расписании нет занятий для архивирования.");
    return;
  }

  openModal("Архивировать расписание", `
    <form class="modal-form" data-modal-form="archiveSchedule">
      <p>Текущая версия будет сохранена по выбранную дату включительно. На следующий день автоматически появится новая версия, которую можно редактировать.</p>
      <label>Архивировать по дату<input type="date" name="archivedThrough" value="${todayISO()}" required /></label>
      <button class="primary-button" type="submit">Создать новую версию</button>
    </form>
  `);
}

function archiveCurrentSchedule(form) {
  const archivedThrough = form.elements.archivedThrough.value;
  const currentRows = employeeSchedule();
  if (!archivedThrough || !currentRows.length) return;
  if (archivedThrough < currentScheduleEffectiveFrom()) {
    alert("Дата архива не может быть раньше начала текущей версии расписания.");
    return;
  }

  const archiveId = crypto.randomUUID();
  const effectiveFrom = currentScheduleEffectiveFrom();
  const nextVersionStart = addDaysISO(archivedThrough, 1);
  const archivedRowIds = new Set(currentRows.map((row) => row.id));
  state.scheduleArchives.push({
    id: archiveId,
    employeeId: state.activeEmployeeId,
    effectiveFrom,
    archivedThrough,
    createdAt: todayISO(),
    title: "Версия расписания"
  });

  const nextVersionRows = currentRows.map((row) => ({
    ...row,
    id: crypto.randomUUID(),
    archiveId: "",
    effectiveFrom: nextVersionStart,
    effectiveTo: ""
  }));

  currentRows.forEach((row) => {
    row.archiveId = archiveId;
    row.effectiveTo = archivedThrough;
  });
  state.records = state.records.filter((record) => (
    !archivedRowIds.has(record.scheduleId)
    || record.date <= archivedThrough
    || record.status === "conducted"
  ));
  state.schedule.push(...nextVersionRows);
  closeModal();
  persistAndRender();
}

function deleteHoliday(id) {
  if (!isAdmin()) return;
  const holiday = state.holidays.find((item) => item.id === id);
  if (!holiday) return;
  if (!confirm(`Удалить дату "${holiday.name}"?`)) return;
  state.holidays = state.holidays.filter((item) => item.id !== id);
  persistAndRender();
}

function deleteStudent(id) {
  state.students = state.students.filter((item) => item.id !== id);
  state.groups.forEach((group) => {
    group.studentIds = (group.studentIds || []).filter((studentId) => studentId !== id);
  });
  state.schedule = state.schedule.filter((row) => row.studentId !== id);
  state.records = state.records.filter((record) => record.studentId !== id);
  persistAndRender();
}

function deleteGroup(id) {
  state.groups = state.groups.filter((item) => item.id !== id);
  state.schedule = state.schedule.filter((row) => row.studentId !== id);
  state.records = state.records.filter((record) => record.studentId !== id);
  persistAndRender();
}

function deleteEmployee(id) {
  if (!isAdmin()) {
    alert("Удалять сотрудников может только администратор.");
    return;
  }

  if (id === state.sessionEmployeeId) {
    alert("Нельзя удалить текущий аккаунт.");
    return;
  }

  if (state.employees.length === 1) {
    alert("Нужен хотя бы один сотрудник.");
    return;
  }
  state.employees = state.employees.filter((item) => item.id !== id);
  state.schedule = state.schedule.filter((item) => item.employeeId !== id);
  state.records = state.records.filter((item) => item.employeeId !== id);
  state.students = state.students.filter((item) => item.employeeId !== id);
  persistAndRender();
}

function setGrade(id, value) {
  const record = state.records.find((item) => item.id === id);
  if (!record) return;

  if (value === "") {
    record.grade = "";
    record.status = record.status === "planned" ? "planned" : "conducted";
    persistAndRender();
    return;
  }

  record.grade = value;
  record.status = "conducted";
  persistAndRender();
}

function generateSelectedMonth() {
  const month = document.querySelector("#journalMonth").value;
  const asOf = document.querySelector("#generateAsOf").value;
  const dates = monthDates(month);
  let created = 0;

  dates.forEach((date) => {
    if (isHoliday(date)) return;
    const dateObj = parseISO(date);
    activeScheduleForDate(date).forEach((row) => {
      if (dateObj.getDay() !== row.weekday) return;
      const exists = state.records.some((record) => record.scheduleId === row.id && record.date === date);
      if (exists) return;
      state.records.push({
        id: crypto.randomUUID(),
        employeeId: row.employeeId,
        scheduleId: row.id,
        date,
        time: row.time,
        studentId: row.studentId,
        studentName: studentName(row.studentId),
        className: row.className,
        educationForm: educationFormForParticipant(row.studentId),
        type: row.type,
        pedHours: row.pedHours,
        kcHours: row.kcHours,
        grade: "",
        status: date <= asOf ? "conducted" : "planned"
      });
      created += 1;
    });
  });

  alert(created ? `Создано записей: ${created}` : "Новых записей не найдено. Уже созданные уроки сохранены.");
  persistAndRender();
}

function renderEmployeeSelect() {
  const select = document.querySelector("#activeEmployee");
  document.querySelector("#cabinetSelectLabel").classList.toggle("is-hidden", !isAdmin());
  select.innerHTML = visibleEmployees()
    .map((employee) => `<option value="${employee.id}">${escapeHtml(employee.name)}</option>`)
    .join("");
  select.value = state.activeEmployeeId;

  const employee = activeEmployee();
  document.querySelector("#activeEmployeeMeta").textContent = employee
    ? `${employee.role} · ${isAdmin() ? "администратор" : "преподаватель"} · 2026-2027 учебный год`
    : "2026-2027 учебный год";
}

function renderDashboard() {
  const upcoming = plannedFromSchedule(14).slice(0, 8);
  document.querySelector("#upcomingList").innerHTML = upcoming.length
    ? upcoming.map(renderLessonCard).join("")
    : `<div class="empty-state">Ближайших занятий пока нет.</div>`;
}

function renderLessonCard(item) {
  return `
    <article class="lesson-card">
      <strong>${formatDate(item.date)}</strong>
      <div>
        <b>${escapeHtml(item.time)} · ${escapeHtml(item.studentName)}</b>
        <p>${escapeHtml(item.type)} · ${escapeHtml(item.className || "без класса")}</p>
      </div>
      <span class="tag">${formatNumber(item.pedHours)} пед. / ${formatNumber(item.kcHours)} конц.</span>
    </article>
  `;
}

function renderSchedule() {
  const board = document.querySelector("#scheduleBoard");
  const dayRows = employeeSchedule()
    .filter((row) => row.weekday === activeScheduleWeekday)
    .sort(compareSchedule);
  const students = visibleStudents().sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const groups = visibleGroups().sort((a, b) => a.name.localeCompare(b.name, "ru"));

  board.innerHTML = `
    <div class="schedule-toolbar">
      <button class="ghost-button" type="button" data-action="printSchedule">Печать по бланку</button>
      <button class="primary-button" type="button" data-action="archiveSchedule">Архивировать расписание</button>
      ${isAdmin() ? `<button class="ghost-button" type="button" data-action="toggleScheduleArchive">${showScheduleArchive ? "Скрыть архив" : "Архив расписаний"}</button>` : ""}
    </div>
    <div class="schedule-tabs">
      ${workWeekdays.map((weekday) => `
        <button class="mini-button ${weekday === activeScheduleWeekday ? "active-day" : ""}" type="button" data-action="scheduleDay:${weekday}">
          ${weekdays[weekday]}
        </button>
      `).join("")}
    </div>
    <div class="schedule-workspace">
      <section class="schedule-roster">
        <div class="schedule-roster-header">
          <h3>\u0414\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0435 \u0443\u0447\u0435\u043d\u0438\u043a\u0438</h3>
          <p>${students.length} \u0443\u0447.</p>
        </div>
        <div class="schedule-student-list">
          ${students.length ? students.map(renderDraggableStudent).join("") : `<div class="empty-state">\u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440 \u0435\u0449\u0435 \u043d\u0435 \u043d\u0430\u0437\u043d\u0430\u0447\u0438\u043b \u0443\u0447\u0435\u043d\u0438\u043a\u043e\u0432.</div>`}
        </div>
      </section>
      <section class="schedule-roster schedule-group-roster">
        <div class="schedule-roster-header">
          <h3>\u0414\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0435 \u0433\u0440\u0443\u043f\u043f\u044b</h3>
          <p>${groups.length} \u0433\u0440.</p>
        </div>
        <div class="schedule-student-list">
          ${groups.length ? groups.map(renderDraggableGroup).join("") : `<div class="empty-state">\u0410\u0434\u043c\u0438\u043d \u0435\u0449\u0435 \u043d\u0435 \u043d\u0430\u0437\u043d\u0430\u0447\u0438\u043b \u0433\u0440\u0443\u043f\u043f\u044b.</div>`}
        </div>
      </section>
      <section class="schedule-day-board">
        <header class="schedule-day-title">
          <div>
            <h3>${weekdays[activeScheduleWeekday]}</h3>
            <p>${dayRows.length ? `\u0417\u0430\u043d\u044f\u0442\u0438\u0439: ${dayRows.length}` : "\u041f\u043e\u043a\u0430 \u043d\u0435\u0442 \u0437\u0430\u043d\u044f\u0442\u0438\u0439"}</p>
          </div>
          <button class="mini-button" type="button" data-action="addScheduleDay:${activeScheduleWeekday}">+</button>
        </header>
        <div class="schedule-drop-zone" data-schedule-drop="${activeScheduleWeekday}">
          <span>\u041f\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u0435 \u0443\u0447\u0435\u043d\u0438\u043a\u0430 \u0438\u043b\u0438 \u0433\u0440\u0443\u043f\u043f\u0443 \u0441\u044e\u0434\u0430, \u0447\u0442\u043e\u0431\u044b \u0434\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0437\u0430\u043d\u044f\u0442\u0438\u0435</span>
        </div>
        <div class="schedule-table-wrap">
          <table class="schedule-table">
            <thead>
              <tr>
                <th>\u0412\u0440\u0435\u043c\u044f</th>
                <th>\u0423\u0447\u0435\u043d\u0438\u043a / \u0433\u0440\u0443\u043f\u043f\u0430</th>
                <th>\u041a\u043b\u0430\u0441\u0441</th>
                <th>\u0412\u0438\u0434</th>
                <th>\u041f\u0435\u0434.</th>
                <th>\u041a\u0446</th>
                <th>\u041a\u0430\u0431.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${dayRows.length ? dayRows.map(renderScheduleRow).join("") : `<tr><td colspan="8" class="empty-state">\u041f\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u0435 \u0443\u0447\u0435\u043d\u0438\u043a\u0430 \u0438\u043b\u0438 \u0433\u0440\u0443\u043f\u043f\u0443 \u0438\u0437 \u0431\u043b\u043e\u043a\u0430 \u0441\u0432\u0435\u0440\u0445\u0443.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    </div>
    ${isAdmin() && showScheduleArchive ? renderScheduleArchive() : ""}
    ${renderSchedulePrintSheet()}
  `;
}

function renderDraggableStudent(student) {
  return `
    <button class="schedule-student-chip" type="button" draggable="true" data-drag-participant="${student.id}">
      <strong>${escapeHtml(student.name)}</strong>
      <span>${escapeHtml(student.className || "\u0431\u0435\u0437 \u043a\u043b\u0430\u0441\u0441\u0430")}</span>
    </button>
  `;
}

function renderDraggableGroup(group) {
  return `
    <button class="schedule-student-chip group-chip" type="button" draggable="true" data-drag-participant="${group.id}">
      <strong>${escapeHtml(group.name)}</strong>
      <span>${escapeHtml(group.className || "\u0433\u0440\u0443\u043f\u043f\u0430")}</span>
    </button>
  `;
}

function renderScheduleRow(row) {
  const participant = participantById(row.studentId);
  const time = scheduleTimeParts(row);
  return `
    <tr class="${row.effectiveTo ? "closed" : ""}" data-schedule-row="${row.id}">
      <td>
        <span class="time-pair">
          <input class="time-part-input" type="text" value="${escapeAttr(time.startHours)}" inputmode="numeric" maxlength="2" data-schedule-id="${row.id}" data-time-bound="start" data-time-part="hours" />
          <span>:</span>
          <input class="time-part-input" type="text" value="${escapeAttr(time.startMinutes)}" inputmode="numeric" maxlength="2" data-schedule-id="${row.id}" data-time-bound="start" data-time-part="minutes" />
          <span class="time-dash">-</span>
          <input class="time-part-input" type="text" value="${escapeAttr(time.endHours)}" inputmode="numeric" maxlength="2" data-schedule-id="${row.id}" data-time-bound="end" data-time-part="hours" />
          <span>:</span>
          <input class="time-part-input" type="text" value="${escapeAttr(time.endMinutes)}" inputmode="numeric" maxlength="2" data-schedule-id="${row.id}" data-time-bound="end" data-time-part="minutes" />
        </span>
      </td>
      <td class="participant-cell"><strong>${escapeHtml(participant?.name || "\u041d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e")}</strong></td>
      <td class="class-cell">${escapeHtml(row.className || participant?.className || "")}</td>
      <td><select class="type-input" data-schedule-id="${row.id}" data-schedule-field="type">${lessonTypeOptions(row.type)}</select></td>
      <td><input class="hours-input calculated-hours" type="text" value="${escapeAttr(row.pedHours)}" data-schedule-field="pedHours" readonly tabindex="-1" /></td>
      <td><input class="hours-input calculated-hours" type="text" value="${escapeAttr(row.kcHours)}" data-schedule-field="kcHours" readonly tabindex="-1" /></td>
      <td><input class="room-input" type="text" inputmode="numeric" value="${escapeAttr(digitsOnly(row.room || ""))}" data-numeric-input data-schedule-id="${row.id}" data-schedule-field="room" /></td>
      <td class="schedule-row-actions">
        <button class="icon-danger-button" type="button" data-action="deleteSchedule:${row.id}" aria-label="\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0437\u0430\u043d\u044f\u0442\u0438\u0435" title="\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0437\u0430\u043d\u044f\u0442\u0438\u0435">&times;</button>
      </td>
    </tr>
  `;
}

function toggleScheduleArchive() {
  if (!isAdmin()) return;
  showScheduleArchive = !showScheduleArchive;
  renderSchedule();
}

function renderScheduleArchive() {
  const archives = (state.scheduleArchives || [])
    .filter((archive) => archive.employeeId === state.activeEmployeeId)
    .sort((a, b) => b.archivedThrough.localeCompare(a.archivedThrough));

  if (!archives.length) {
    return `<section class="schedule-archive-panel"><h3>Архив расписаний</h3><div class="empty-state">Архивных версий пока нет.</div></section>`;
  }

  return `
    <section class="schedule-archive-panel">
      <header class="schedule-day-title">
        <div><h3>Архив расписаний</h3><p>Архивные строки может изменять только администратор.</p></div>
      </header>
      ${archives.map((archive) => {
        const rows = state.schedule
          .filter((row) => row.archiveId === archive.id && row.weekday === activeScheduleWeekday)
          .sort(compareSchedule);
        return `
          <div class="schedule-archive-version">
            <h4>${escapeHtml(archive.title || "Архивная версия")}: ${archivePeriodLabel(archive, rows)} - ${escapeHtml(weekdays[activeScheduleWeekday])}</h4>
            <div class="schedule-table-wrap">
              <table class="schedule-table">
                <thead><tr><th>Время</th><th>Ученик / группа</th><th>Класс</th><th>Вид</th><th>Пед.</th><th>Кц</th><th>Каб.</th><th></th></tr></thead>
                <tbody>${rows.length ? rows.map(renderScheduleRow).join("") : `<tr><td colspan="8" class="empty-state">В этот день занятий не было.</td></tr>`}</tbody>
              </table>
            </div>
          </div>
        `;
      }).join("")}
    </section>
  `;
}

function archivePeriodLabel(archive, rows) {
  const effectiveFrom = archive.effectiveFrom || rows.map((row) => row.effectiveFrom).filter(Boolean).sort()[0];
  if (!effectiveFrom) return `по ${formatDate(archive.archivedThrough)}`;
  return `с ${formatDate(effectiveFrom)} по ${formatDate(archive.archivedThrough)}`;
}

function renderSchedulePrintSheet() {
  const rows = employeeSchedule().sort(compareSchedule);
  const splitAt = Math.ceil(rows.length / 2);
  const columns = [rows.slice(0, splitAt), rows.slice(splitAt)];
  const employee = activeEmployee();
  const pedHours = sum(rows, "pedHours");
  const kcHours = sum(rows, "kcHours");

  return `
    <section class="schedule-print-sheet" aria-hidden="true">
      <div class="schedule-print-director">Директор _______________________</div>
      <h1>ИНДИВИДУАЛЬНОЕ РАСПИСАНИЕ</h1>
      <p class="schedule-print-year">на 2026-2027 уч. год</p>
      <p class="schedule-print-teacher">Ф. И. О. ${escapeHtml(employee?.name || "")}</p>
      <div class="schedule-print-columns">
        ${columns.map((column) => `
          <table>
            <thead><tr><th>День недели</th><th>Фамилия, имя обучающегося / предмет</th><th>Класс</th><th>Пед.</th><th>К/ц</th><th>Аудитория, время</th></tr></thead>
            <tbody>${column.map(renderSchedulePrintRow).join("") || `<tr><td colspan="6"></td></tr>`}</tbody>
          </table>
        `).join("")}
      </div>
      <p class="schedule-print-load">Недельная нагрузка: ${formatNumber(pedHours)} пед.ч., ${formatNumber(kcHours)} кц.ч.</p>
      <div class="schedule-print-signatures"><span>преподаватель _______________________</span><span>Зам. директора по УВР _______________________</span></div>
    </section>
  `;
}

function renderSchedulePrintRow(row) {
  const participant = participantById(row.studentId);
  return `
    <tr>
      <td>${escapeHtml(weekdays[row.weekday] || "")}</td>
      <td><strong>${escapeHtml(participant?.name || "Не найдено")}</strong><small>${escapeHtml(row.type || "")}</small></td>
      <td>${escapeHtml(row.className || participant?.className || "")}</td>
      <td>${formatNumber(row.pedHours)}</td>
      <td>${formatNumber(row.kcHours)}</td>
      <td>${escapeHtml([row.room ? `каб. ${row.room}` : "", row.time].filter(Boolean).join(", "))}</td>
    </tr>
  `;
}

function printSchedule() {
  document.body.classList.add("printing-schedule");
  window.print();
}

window.addEventListener("afterprint", () => document.body.classList.remove("printing-schedule"));

function setActiveScheduleDay(weekday) {
  if (!workWeekdays.includes(weekday)) return;
  activeScheduleWeekday = weekday;
  renderSchedule();
}

function addScheduleFromParticipant(participantId, weekday) {
  const participant = visibleParticipants().find((item) => item.id === participantId);
  if (!participant || !workWeekdays.includes(weekday)) return;
  state.schedule.push({
    id: crypto.randomUUID(),
    employeeId: state.activeEmployeeId,
    effectiveFrom: currentScheduleEffectiveFrom(),
    effectiveTo: "",
    archiveId: "",
    weekday,
    time: "",
    studentId: participant.id,
    groupId: "",
    className: participant.className || "",
    type: participant.kind === "group" && participant.name === "\u041e\u0440\u043a\u0435\u0441\u0442\u0440" ? "\u041e\u0440\u043a\u0435\u0441\u0442\u0440" : "\u0418\u043d\u0434\u0438\u0432\u0438\u0434\u0443\u0430\u043b\u044c\u043d\u044b\u0439 \u0443\u0440\u043e\u043a",
    pedHours: 1,
    kcHours: 0,
    room: ""
  });
  persistAndRender();
}

function renderJournal() {
  const month = document.querySelector("#journalMonth").value;
  const records = employeeRecords().filter((record) => record.date.startsWith(month) && !isHoliday(record.date));
  const dates = uniqueRecordDates(records);

  document.querySelector("#journalTitle").textContent = `Журнал за ${monthLabel(month)}`;
  if (!dates.length) {
    document.querySelector("#journalMatrix").innerHTML = `<div class="empty-state">Нет дат занятий за выбранный месяц.</div>`;
    return;
  }

  const columnCount = dates.length + 4;
  const rows = journalSections(records).map((section) => `
    <tr class="journal-program-row"><td colspan="${columnCount}">${escapeHtml(section.educationForm)}</td></tr>
    ${section.subjects.map((subject) => `
      <tr class="journal-subject-row"><td colspan="${columnCount}">${escapeHtml(subject.name)}</td></tr>
      ${subject.entries.map((entry) => {
        const cells = dates.map((date) => renderJournalCell(entry, date)).join("");
        const countable = entry.records.filter(countableRecord);
        return `
          <tr>
            <td class="student-cell">${escapeHtml(entry.name)}</td>
            <td class="class-cell">${escapeHtml(entry.className || "")}</td>
            ${cells}
            <td class="summary-cell">${formatNumber(sum(countable, "pedHours"))}</td>
            <td class="summary-cell">${formatNumber(sum(countable, "kcHours"))}</td>
          </tr>
        `;
      }).join("")}
    `).join("")}
  `).join("");

  const head = dates.map((date) => `<th class="date-cell ${isHoliday(date) ? "holiday-col" : ""}">${parseISO(date).getDate()}</th>`).join("");
  const totals = journalTotals(records);
  document.querySelector("#journalMatrix").innerHTML = `
    <table class="journal-table">
      <thead>
        <tr>
          <th class="student-cell">Фамилия и имя обучающегося</th>
          <th class="class-cell">Класс</th>
          ${head}
          <th>Пед.</th>
          <th>Конц.</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="journal-totals">
      ${renderJournalTotal("ДПП", totals.dpp)}
      ${renderJournalTotal("ДОП", totals.dop)}
      ${renderJournalTotal("Итого", totals.total)}
    </div>
  `;
}

function journalTotals(records) {
  const total = { ped: 0, kc: 0 };
  const dpp = { ped: 0, kc: 0 };
  const dop = { ped: 0, kc: 0 };

  records.filter(countableRecord).forEach((record) => {
    const target = normalizeEducationForm(record.educationForm || educationFormForParticipant(record.studentId)) === "ДОП" ? dop : dpp;
    const ped = Number(record.pedHours || 0);
    const kc = Number(record.kcHours || 0);
    target.ped += ped;
    target.kc += kc;
    total.ped += ped;
    total.kc += kc;
  });
  return { dpp, dop, total };
}

function renderJournalTotal(label, hours) {
  return `
    <div class="journal-total-card">
      <strong>${label}</strong>
      <span>Пед.: ${formatNumber(hours.ped)}</span>
      <span>Кц: ${formatNumber(hours.kc)}</span>
      <b>Всего: ${formatNumber(hours.ped + hours.kc)}</b>
    </div>
  `;
}

function renderJournalCell(entry, date) {
  const dayRecords = entry.records.filter((item) => item.date === date);
  if (!dayRecords.length) return "<td></td>";

  const buttons = dayRecords.map((record) => {
    const grade = record.grade || "";
    return `
      <select class="grade-select" title="${escapeHtml(record.time)} ${escapeHtml(record.type)} · ${formatNumber(record.pedHours)} пед. / ${formatNumber(record.kcHours)} конц." data-grade-record="${record.id}">
        ${gradeOptions(grade)}
      </select>
    `;
  }).join("");

  return `<td class="${dayRecords[0].status}-col"><div class="cell-stack">${buttons}</div></td>`;
}

function journalSections(records) {
  const entries = new Map();

  records.forEach((record) => {
    const educationForm = normalizeEducationForm(record.educationForm || educationFormForParticipant(record.studentId));
    const subject = educationForm === "ДОП" ? dopSubjectName : (record.type || "Без предмета");
    const key = [educationForm, subject, record.studentId].join("|");
    if (!entries.has(key)) {
      entries.set(key, {
        educationForm,
        subject,
        studentId: record.studentId,
        name: record.studentName || studentName(record.studentId),
        className: record.className || participantById(record.studentId)?.className || "",
        records: []
      });
    }
    entries.get(key).records.push(record);
  });

  return educationForms.map((educationForm) => {
    const formEntries = [...entries.values()].filter((entry) => entry.educationForm === educationForm);
    const subjects = [...new Set(formEntries.map((entry) => entry.subject))]
      .sort(compareJournalSubjects)
      .map((name) => ({
        name,
        entries: formEntries
          .filter((entry) => entry.subject === name)
          .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      }));
    return { educationForm, subjects };
  }).filter((section) => section.subjects.length);
}

function compareJournalSubjects(first, second) {
  if (first === dopSubjectName) return -1;
  if (second === dopSubjectName) return 1;
  const firstIndex = lessonTypes.indexOf(first);
  const secondIndex = lessonTypes.indexOf(second);
  return (firstIndex < 0 ? Number.MAX_SAFE_INTEGER : firstIndex)
    - (secondIndex < 0 ? Number.MAX_SAFE_INTEGER : secondIndex)
    || first.localeCompare(second, "ru");
}

function renderPeople() {
  document.querySelector("#employeeForm").classList.add("is-hidden");
  document.querySelector("#employeesList").closest(".content-panel").classList.toggle("is-hidden", !isAdmin());
  document.querySelectorAll('[data-action="openStudentModal:add"], [data-action="openGroupModal:add"], [data-action="openEmployeeModal:add"]').forEach((button) => {
    button.classList.toggle("is-hidden", !isAdmin());
  });

  const teacherFilter = document.querySelector("#peopleTeacherFilter");
  const teacherFilterLabel = document.querySelector("#peopleTeacherFilterLabel");
  const studentInstrumentFilter = document.querySelector("#studentInstrumentFilter");
  const employeeInstrumentFilter = document.querySelector("#employeeInstrumentFilter");
  const searchInput = document.querySelector("#studentSearch");
  const employeeSearchInput = document.querySelector("#employeeSearch");

  refreshSelect(teacherFilter, teacherOptions(), isAdmin() ? teacherFilter?.value || "" : state.sessionEmployeeId);
  refreshSelect(studentInstrumentFilter, instrumentOptions(studentInstrumentFilter?.value || ""), studentInstrumentFilter?.value || "");
  refreshSelect(employeeInstrumentFilter, instrumentOptions(employeeInstrumentFilter?.value || ""), employeeInstrumentFilter?.value || "");
  teacherFilterLabel?.classList.toggle("is-hidden", !isAdmin());

  const selectedTeacherId = isAdmin() ? teacherFilter?.value || "" : state.sessionEmployeeId;
  const selectedStudentInstrument = studentInstrumentFilter?.value || "";
  const selectedEmployeeInstrument = employeeInstrumentFilter?.value || "";
  const studentSearch = normalizeText(searchInput?.value || "");
  const employeeSearch = normalizeText(employeeSearchInput?.value || "");
  const teacherMatches = (ids) => !selectedTeacherId || (ids || []).includes(selectedTeacherId);

  const studentSource = isAdmin() ? state.students : visibleStudents();
  const groupSource = isAdmin() ? state.groups : visibleGroups();
  const students = studentSource
    .filter((student) => teacherMatches(student.assignedEmployeeIds))
    .filter((student) => matchesInstrument(student.assignedEmployeeIds, selectedStudentInstrument))
    .filter((student) => !studentSearch || normalizeText(student.name).includes(studentSearch))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const groups = groupSource
    .filter((group) => teacherMatches(group.assignedEmployeeIds))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const employees = state.employees
    .filter((employee) => isAdmin() || employee.id === state.sessionEmployeeId)
    .filter((employee) => !selectedEmployeeInstrument || employeeInstrument(employee) === selectedEmployeeInstrument)
    .filter((employee) => !employeeSearch || normalizeText(employee.name).includes(employeeSearch))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  const studentPage = paginate(students, "students");
  const groupPage = paginate(groups, "groups");
  const employeePage = paginate(employees, "employees");

  document.querySelector("#studentsList").innerHTML = studentPage.items.map((student) => `
    <article class="person-card compact-person-card">
      <div>
        <h3>${escapeHtml(student.name)}</h3>
        <p>${escapeHtml(student.className || "\u0431\u0435\u0437 \u043a\u043b\u0430\u0441\u0441\u0430")}</p>
        <p>\u0424\u043e\u0440\u043c\u0430: ${escapeHtml(student.educationForm)}</p>
        <p>\u0418\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442: ${escapeHtml(studentInstrumentNames(student).join(", ") || "\u043d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d")}</p>
        <p>${isAdmin() ? `\u041f\u0440\u0435\u043f\u043e\u0434\u0430\u0432\u0430\u0442\u0435\u043b\u044c: ${assignedTeacherNames(student.assignedEmployeeIds || [])}` : "\u041f\u0440\u0435\u043f\u043e\u0434\u0430\u0432\u0430\u0442\u0435\u043b\u044c: \u0432\u044b"}</p>
      </div>
      <footer>
        <span class="tag">\u0423\u0447\u0435\u043d\u0438\u043a</span>
        ${isAdmin() ? `<span class="card-actions"><button class="mini-button" type="button" data-action="assignStudent:${student.id}">\u041d\u0430\u0437\u043d\u0430\u0447\u0438\u0442\u044c</button><button class="danger-button" type="button" data-action="deleteStudent:${student.id}">\u0423\u0434\u0430\u043b\u0438\u0442\u044c</button></span>` : ""}
      </footer>
    </article>
  `).join("") || `<div class="empty-state">\u0423\u0447\u0435\u043d\u0438\u043a\u0438 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u044b.</div>`;
  document.querySelector("#studentsPagination").innerHTML = renderPagination("students", studentPage.totalPages, studentPage.page, students.length);

  document.querySelector("#groupsList").innerHTML = groupPage.items.map((group) => `
    <article class="person-card compact-person-card">
      <div>
        <h3>${escapeHtml(group.name)}</h3>
        <p>${escapeHtml(group.className || "\u0433\u0440\u0443\u043f\u043f\u0430")}</p>
        <p>\u0424\u043e\u0440\u043c\u0430: ${escapeHtml(group.educationForm)}</p>
        <p class="line-clamp">\u0421\u043e\u0441\u0442\u0430\u0432: ${group.studentIds.map(studentName).map(escapeHtml).join(", ") || "\u043f\u0443\u0441\u0442\u043e"}</p>
        <p>${isAdmin() ? `\u041f\u0440\u0435\u043f\u043e\u0434\u0430\u0432\u0430\u0442\u0435\u043b\u044c: ${assignedTeacherNames(group.assignedEmployeeIds || [])}` : "\u041f\u0440\u0435\u043f\u043e\u0434\u0430\u0432\u0430\u0442\u0435\u043b\u044c: \u0432\u044b"}</p>
      </div>
      <footer>
        <span class="tag">\u0413\u0440\u0443\u043f\u043f\u0430</span>
        ${isAdmin() ? `<span class="card-actions"><button class="mini-button" type="button" data-action="assignGroup:${group.id}">\u041d\u0430\u0441\u0442\u0440\u043e\u0438\u0442\u044c</button><button class="danger-button" type="button" data-action="deleteGroup:${group.id}">\u0423\u0434\u0430\u043b\u0438\u0442\u044c</button></span>` : ""}
      </footer>
    </article>
  `).join("") || `<div class="empty-state">\u0413\u0440\u0443\u043f\u043f\u044b \u043d\u0435 \u0441\u043e\u0437\u0434\u0430\u043d\u044b.</div>`;
  document.querySelector("#groupsPagination").innerHTML = renderPagination("groups", groupPage.totalPages, groupPage.page, groups.length);

  document.querySelector("#employeesList").innerHTML = employeePage.items.map((employee) => `
    <article class="person-card compact-person-card">
      <div>
        <h3>${escapeHtml(employee.name)}</h3>
        <p>${escapeHtml(employeeInstrument(employee))} \u00b7 ${escapeHtml(employee.username)}${employee.isAdmin ? " \u00b7 \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440" : ""}</p>
      </div>
      <footer>
        <span class="tag">${employee.id === state.activeEmployeeId ? "\u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0439" : "\u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a"}</span>
        ${isAdmin() ? `<button class="danger-button" type="button" data-action="deleteEmployee:${employee.id}">\u0423\u0434\u0430\u043b\u0438\u0442\u044c</button>` : ""}
      </footer>
    </article>
  `).join("") || `<div class="empty-state">\u0421\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0438 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u044b.</div>`;
  document.querySelector("#employeesPagination").innerHTML = renderPagination("employees", employeePage.totalPages, employeePage.page, employees.length);
}

function teacherOptions() {
  return `<option value="">\u0412\u0441\u0435 \u043f\u0440\u0435\u043f\u043e\u0434\u0430\u0432\u0430\u0442\u0435\u043b\u0438</option>` + state.employees
    .filter((employee) => !employee.isAdmin)
    .map((employee) => `<option value="${employee.id}">${escapeHtml(employee.name)}</option>`)
    .join("");
}

function instrumentOptions(selectedValue) {
  const instruments = [...new Set(state.employees
    .filter((employee) => !employee.isAdmin)
    .map(employeeInstrument)
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
  return `<option value="">\u0412\u0441\u0435 \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b</option>` + instruments
    .map((instrument) => `<option value="${escapeAttr(instrument)}" ${instrument === selectedValue ? "selected" : ""}>${escapeHtml(instrument)}</option>`)
    .join("");
}

function refreshSelect(select, options, selectedValue) {
  if (!select) return;
  const current = selectedValue || select.value;
  select.innerHTML = options;
  select.value = [...select.options].some((option) => option.value === current) ? current : "";
}

function employeeInstrument(employee) {
  return employee?.role || "\u0411\u0435\u0437 \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u0430";
}

function studentInstrumentNames(student) {
  return [...new Set((student.assignedEmployeeIds || [])
    .map((id) => state.employees.find((employee) => employee.id === id))
    .filter(Boolean)
    .map(employeeInstrument)
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
}

function matchesInstrument(employeeIds, instrument) {
  if (!instrument) return true;
  return (employeeIds || []).some((id) => employeeInstrument(state.employees.find((employee) => employee.id === id)) === instrument);
}

function paginate(items, key) {
  const totalPages = Math.max(1, Math.ceil(items.length / peoplePageSize));
  peoplePages[key] = Math.min(Math.max(peoplePages[key] || 1, 1), totalPages);
  const page = peoplePages[key];
  const start = (page - 1) * peoplePageSize;
  return { items: items.slice(start, start + peoplePageSize), page, totalPages };
}

function renderPagination(key, totalPages, page, totalItems) {
  if (totalItems <= peoplePageSize) return totalItems ? `<span>${totalItems} \u0437\u0430\u043f\u0438\u0441\u0435\u0439</span>` : "";
  const pageNumbers = [1, page - 1, page, page + 1, totalPages]
    .filter((number) => number >= 1 && number <= totalPages)
    .filter((number, index, list) => list.indexOf(number) === index)
    .sort((a, b) => a - b);
  const buttons = pageNumbers.reduce((html, number, index) => {
    const previous = pageNumbers[index - 1];
    const gap = previous && number - previous > 1 ? `<span class="pagination-ellipsis">&hellip;</span>` : "";
    return html + gap + `<button class="mini-button ${number === page ? "active-page" : ""}" type="button" data-action="peoplePage:${key}|${number}">${number}</button>`;
  }, "");
  const previousButton = `<button class="mini-button pagination-arrow" type="button" ${page === 1 ? "disabled" : `data-action="peoplePage:${key}|${page - 1}"`}>&lsaquo;</button>`;
  const nextButton = `<button class="mini-button pagination-arrow" type="button" ${page === totalPages ? "disabled" : `data-action="peoplePage:${key}|${page + 1}"`}>&rsaquo;</button>`;
  return `<span>${totalItems} \u0437\u0430\u043f\u0438\u0441\u0435\u0439</span><div>${previousButton}${buttons}${nextButton}</div>`;
}

function setPeoplePage(value) {
  const [key, page] = String(value || "").split("|");
  if (!peoplePages[key]) return;
  peoplePages[key] = Number(page) || 1;
  renderPeople();
}

function resetPeoplePages() {
  peoplePages.students = 1;
  peoplePages.groups = 1;
  peoplePages.employees = 1;
}


function renderHolidays() {
  const canManageHolidays = isAdmin();
  document.querySelector("#holidayForm").classList.toggle("is-hidden", !canManageHolidays);
  document.querySelector('[data-action="openHolidayModal:add"]').classList.toggle("is-hidden", !canManageHolidays);
  document.querySelector("#calendarView .panel-toolbar p").textContent = canManageHolidays
    ? "Красным выделены каникулы, праздники и воскресенья. По нажатию на дату можно добавить неучебный день вручную."
    : "Красным выделены каникулы, праздники и воскресенья.";
  document.querySelector("#holidaysList").innerHTML = schoolYearMonths().map(renderCalendarMonth).join("");
}

function renderCalendarMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(year, monthNumber - 1, 1);
  const startOffset = first.getDay() === 0 ? 6 : first.getDay() - 1;
  const totalDays = new Date(year, monthNumber, 0).getDate();
  const cells = [];

  for (let index = 0; index < startOffset; index += 1) {
    cells.push(`<div class="calendar-day muted"></div>`);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const holiday = state.holidays.find((item) => item.date === date);
    const sunday = parseISO(date).getDay() === 0;
    const canManageHolidays = isAdmin();
    cells.push(`
      <div class="calendar-day ${holiday ? "holiday-day" : ""} ${sunday ? "weekend-day" : ""}" ${canManageHolidays ? `data-action="openHolidayDate:${date}" title="${holiday ? escapeAttr(holiday.name) : "Добавить выходной"}"` : (holiday ? `title="${escapeAttr(holiday.name)}"` : "")}>
        <strong>${day}</strong>
        ${holiday ? `<span>${escapeHtml(holiday.name)}</span>${canManageHolidays ? `<button type="button" title="Удалить дату" data-action="deleteHoliday:${holiday.id}">×</button>` : ""}` : sunday ? `<span>Воскресенье</span>` : ""}
      </div>
    `);
  }

  return `
    <section class="calendar-month">
      <header>${monthLabel(month)}</header>
      <div class="calendar-weekdays">
        <span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span>
      </div>
      <div class="calendar-days">${cells.join("")}</div>
    </section>
  `;
}

function employeeSchedule() {
  return state.schedule.filter((row) => row.employeeId === state.activeEmployeeId && !row.archiveId);
}

function employeeScheduleHistory() {
  return state.schedule.filter((row) => row.employeeId === state.activeEmployeeId);
}

function employeeRecords() {
  return state.records.filter((record) => record.employeeId === state.activeEmployeeId);
}

function activeEmployee() {
  return state.employees.find((employee) => employee.id === state.activeEmployeeId);
}

function currentUser() {
  return state.employees.find((employee) => employee.id === state.sessionEmployeeId);
}

function isAdmin() {
  return Boolean(currentUser()?.isAdmin);
}

function visibleEmployees() {
  if (!isAdmin()) return currentUser() ? [currentUser()] : [];
  const teachers = state.employees.filter((employee) => !employee.isAdmin);
  return teachers.length ? teachers : state.employees;
}

function visibleStudents() {
  if (isAdmin()) {
    return state.students.filter((student) => (student.assignedEmployeeIds || []).includes(state.activeEmployeeId));
  }
  return state.students.filter((student) => (student.assignedEmployeeIds || []).includes(state.sessionEmployeeId));
}

function visibleGroups() {
  if (isAdmin()) {
    return state.groups.filter((group) => (group.assignedEmployeeIds || []).includes(state.activeEmployeeId));
  }
  return state.groups.filter((group) => (group.assignedEmployeeIds || []).includes(state.sessionEmployeeId));
}

function visibleParticipants() {
  const groups = visibleGroups().map((group) => ({ ...group, kind: "group" }));
  const directStudents = visibleStudents().map((student) => ({ ...student, kind: "student" }));
  const groupStudentIds = new Set(groups.flatMap((group) => group.studentIds || []));
  const groupStudents = state.students
    .filter((student) => groupStudentIds.has(student.id))
    .map((student) => ({ ...student, kind: "student" }));
  return uniqueById([...directStudents, ...groupStudents, ...groups]);
}

function participantById(id) {
  const student = state.students.find((item) => item.id === id);
  if (student) return { ...student, kind: "student" };
  const group = state.groups.find((item) => item.id === id);
  if (group) return { ...group, kind: "group" };
  return null;
}

function activeScheduleForDate(date) {
  return employeeScheduleHistory().filter((row) => row.effectiveFrom <= date && (!row.effectiveTo || row.effectiveTo >= date));
}

function currentScheduleEffectiveFrom() {
  const starts = employeeSchedule().map((row) => row.effectiveFrom).filter(Boolean).sort();
  return starts[0] || "2025-09-01";
}

function plannedFromSchedule(daysAhead) {
  const result = [];
  const start = new Date();
  for (let offset = 0; offset <= daysAhead; offset += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + offset);
    const iso = date.toISOString().slice(0, 10);
    if (isHoliday(iso)) continue;
    activeScheduleForDate(iso).forEach((row) => {
      if (date.getDay() !== row.weekday) return;
      result.push({
        date: iso,
        time: row.time,
        studentName: studentName(row.studentId),
        className: row.className,
        type: row.type,
        pedHours: row.pedHours,
        kcHours: row.kcHours
      });
    });
  }
  return result.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

function uniqueJournalStudents(records) {
  const map = new Map();
  records.forEach((record) => {
    if (!map.has(record.studentId)) {
      map.set(record.studentId, { id: record.studentId, name: record.studentName, className: record.className });
    }
  });
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

function uniqueRecordDates(records) {
  return [...new Set(records.map((record) => record.date))].sort();
}

function monthDates(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const last = new Date(year, monthNumber, 0).getDate();
  return Array.from({ length: last }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}

function schoolYearMonths() {
  return [
    "2026-09",
    "2026-10",
    "2026-11",
    "2026-12",
    "2027-01",
    "2027-02",
    "2027-03",
    "2027-04",
    "2027-05",
    "2027-06",
    "2027-07",
    "2027-08"
  ];
}

function isHoliday(date) {
  return parseISO(date).getDay() === 0 || state.holidays.some((holiday) => holiday.date === date);
}

function holidayName(date) {
  return state.holidays.find((holiday) => holiday.date === date)?.name
    || (parseISO(date).getDay() === 0 ? "Воскресенье" : "Праздник");
}

function countableStatus(status) {
  return status === "conducted" || status === "planned";
}

function countableRecord(record) {
  return countableStatus(record.status) && !isHoliday(record.date);
}

function sum(items, key) {
  return items.reduce((total, item) => total + Number(item[key] || 0), 0);
}

function studentName(id) {
  return participantById(id)?.name || "Не найдено";
}

function compareSchedule(a, b) {
  return a.weekday - b.weekday
    || scheduleStartMinutes(a) - scheduleStartMinutes(b)
    || a.id.localeCompare(b.id);
}

function scheduleStartMinutes(row) {
  const { startHours, startMinutes } = splitScheduleTime(row.time);
  if (!startHours) return Number.MAX_SAFE_INTEGER;
  return Number(startHours) * 60 + Number(startMinutes || 0);
}

function studentOptions(selectedId) {
  return visibleStudents().map((student) => {
    const selected = student.id === selectedId ? "selected" : "";
    const suffix = student.className ? `, ${student.className}` : "";
    return `<option value="${student.id}" ${selected}>${escapeHtml(student.name + suffix)}</option>`;
  }).join("");
}

function groupOptions(selectedId) {
  return `<option value="">Без группы</option>` + visibleGroups().map((group) => {
    const selected = group.id === selectedId ? "selected" : "";
    return `<option value="${group.id}" ${selected}>${escapeHtml(group.name)}</option>`;
  }).join("");
}

function normalizeText(value) {
  return String(value || "").trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function splitScheduleTime(value) {
  const [startSource = "", endSource = ""] = String(value || "").split("-");
  const start = timePartsFromText(startSource);
  const end = timePartsFromText(endSource);
  return {
    startHours: start.hours,
    startMinutes: start.minutes,
    endHours: end.hours,
    endMinutes: end.minutes
  };
}

function scheduleTimeParts(row) {
  const parts = splitScheduleTime(row.time);
  if (!parts.endHours && parts.startHours) {
    const end = addMinutesToTime(`${parts.startHours}:${parts.startMinutes || "00"}`, (Number(row.pedHours || 0) + Number(row.kcHours || 0)) * 40);
    const endParts = timePartsFromText(end);
    parts.endHours = endParts.hours;
    parts.endMinutes = endParts.minutes;
  }
  return parts;
}

function timePartsFromText(value) {
  const match = String(value || "").match(/(\d{1,2})\D?(\d{0,2})/);
  return {
    hours: match?.[1] || "",
    minutes: match?.[2] || ""
  };
}

function addMinutesToTime(time, minutesToAdd) {
  const parts = timePartsFromText(time);
  if (!parts.hours) return "";
  const total = (Number(parts.hours) * 60 + Number(parts.minutes || 0) + Number(minutesToAdd || 0)) % (24 * 60);
  const hours = String(Math.floor(total / 60)).padStart(2, "0");
  const minutes = String(total % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function updateHoursFromTime(row) {
  const units = lessonUnitsFromTime(row.time);
  if (units === null) return;

  if (row.type === "Концертмейстер") {
    row.kcHours = units;
    row.pedHours = 0;
  } else {
    row.pedHours = units;
    row.kcHours = 0;
  }
}

function lessonUnitsFromTime(value) {
  const parts = splitScheduleTime(value);
  if (!parts.startHours || !parts.endHours) return null;
  if (partialHour(parts.startHours) || partialHour(parts.endHours)) return null;
  const start = minutesFromParts(parts.startHours, parts.startMinutes);
  let end = minutesFromParts(parts.endHours, parts.endMinutes);
  if (end < start) end += 24 * 60;
  const duration = end - start;
  return Number((duration / 40).toFixed(2));
}

function partialHour(value) {
  return String(value || "").length === 1 && ["1", "2"].includes(String(value));
}

function minutesFromParts(hours, minutes) {
  return Number(hours || 0) * 60 + Number(minutes || 0);
}

function gradeOptions(selectedGrade) {
  return ["", "2-", "2", "2+", "3-", "3", "3+", "4-", "4", "4+", "5-", "5", "5+"]
    .map((grade) => `<option value="${grade}" ${grade === selectedGrade ? "selected" : ""}>${grade || "□"}</option>`)
    .join("");
}

function participantOptions(selectedId) {
  return visibleParticipants().map((participant) => {
    const selected = participant.id === selectedId ? "selected" : "";
    const label = participant.kind === "group" ? `Группа: ${participant.name}` : participant.name;
    return `<option value="${participant.id}" ${selected}>${escapeHtml(label)}</option>`;
  }).join("");
}

function teacherCheckboxes(selectedIds) {
  return state.employees
    .filter((employee) => !employee.isAdmin)
    .map((employee) => `
      <label class="checkbox-label">
        <input type="checkbox" name="employeeIds" value="${employee.id}" ${selectedIds.includes(employee.id) ? "checked" : ""} />
        ${escapeHtml(employee.name)}
      </label>
    `).join("");
}

function studentPicker(selectedIds) {
  const ids = uniqueByIdValues(selectedIds || []);
  return `
    <div class="student-picker" data-student-picker>
      <input type="hidden" name="studentIdsValue" value="${escapeAttr(ids.join(","))}" data-student-picker-value />
      <div class="student-picker-selected" data-student-picker-selected>
        ${renderStudentPickerSelected(ids)}
      </div>
      <label>Поиск ученика<input type="text" data-student-picker-search placeholder="Начните писать фамилию или имя" autocomplete="off" /></label>
      <div class="student-picker-results" data-student-picker-results>
        <div class="muted-note">Введите минимум 2 буквы, чтобы найти ученика.</div>
      </div>
    </div>
  `;
}

function renderStudentPickerSelected(ids) {
  const students = ids.map((id) => state.students.find((student) => student.id === id)).filter(Boolean);
  if (!students.length) return `<div class="muted-note">Ученики пока не выбраны.</div>`;
  return students.map((student) => `
    <span class="student-token">
      ${escapeHtml(student.name)} · ${escapeHtml(student.className || "без класса")}
      <button type="button" data-student-picker-remove="${student.id}" aria-label="Убрать ученика">&times;</button>
    </span>
  `).join("");
}

function renderStudentPickerResults(picker) {
  if (!picker) return;
  const query = normalizeText(picker.querySelector("[data-student-picker-search]")?.value || "");
  const results = picker.querySelector("[data-student-picker-results]");
  const selected = selectedStudentIdsFromPicker(picker);
  if (!results) return;

  if (query.length < 2) {
    results.innerHTML = `<div class="muted-note">Введите минимум 2 буквы, чтобы найти ученика.</div>`;
    return;
  }

  const matches = state.students
    .filter((student) => normalizeText(student.name).includes(query))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
    .slice(0, 20);

  results.innerHTML = matches.length ? matches.map((student) => `
    <label class="checkbox-label">
      <input type="checkbox" data-student-picker-choice value="${student.id}" ${selected.includes(student.id) ? "checked" : ""} />
      ${escapeHtml(student.name)} · ${escapeHtml(student.className || "без класса")}
    </label>
  `).join("") : `<div class="muted-note">Совпадений не найдено.</div>`;
}

function selectedStudentIdsFromForm(form) {
  const picker = form.querySelector("[data-student-picker]");
  return picker ? selectedStudentIdsFromPicker(picker) : checkedValues(form, "studentIds");
}

function selectedStudentIdsFromPicker(picker) {
  const value = picker.querySelector("[data-student-picker-value]")?.value || "";
  return uniqueByIdValues(value.split(","));
}

function setStudentPickerSelection(input) {
  const picker = input.closest("[data-student-picker]");
  if (!picker) return;
  const ids = selectedStudentIdsFromPicker(picker);
  const nextIds = input.checked ? uniqueByIdValues([...ids, input.value]) : ids.filter((id) => id !== input.value);
  updateStudentPicker(picker, nextIds);
}

function removeStudentFromPicker(button) {
  const picker = button.closest("[data-student-picker]");
  if (!picker) return;
  const ids = selectedStudentIdsFromPicker(picker).filter((id) => id !== button.dataset.studentPickerRemove);
  updateStudentPicker(picker, ids);
}

function updateStudentPicker(picker, ids) {
  picker.querySelector("[data-student-picker-value]").value = uniqueByIdValues(ids).join(",");
  picker.querySelector("[data-student-picker-selected]").innerHTML = renderStudentPickerSelected(ids);
  renderStudentPickerResults(picker);
}

function checkedValues(form, name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
}

function assignedTeacherNames(ids) {
  const names = state.employees.filter((employee) => ids.includes(employee.id)).map((employee) => employee.name);
  return names.length ? names.join(", ") : "не назначено";
}

function uniqueById(items) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function nextStudentExternalId() {
  return `S-${String(state.students.length + 1).padStart(4, "0")}`;
}

function nextGroupExternalId() {
  return `G-${String(state.groups.length + 1).padStart(4, "0")}`;
}

function lessonTypeOptions(selectedType) {
  return lessonTypes.map((type) => {
    const selected = type === selectedType ? "selected" : "";
    return `<option value="${escapeAttr(type)}" ${selected}>${escapeHtml(type)}</option>`;
  }).join("");
}

function educationFormOptions(selectedForm) {
  const current = normalizeEducationForm(selectedForm);
  return educationForms.map((form) => {
    const selected = form === current ? "selected" : "";
    return `<option value="${form}" ${selected}>${form}</option>`;
  }).join("");
}

function normalizeEducationForm(value) {
  return educationForms.includes(value) ? value : "ДПП";
}

function educationFormForParticipant(id) {
  return normalizeEducationForm(participantById(id)?.educationForm);
}

function formatNumber(value) {
  return Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ru-RU").format(parseISO(value));
}

function monthLabel(month) {
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(parseISO(`${month}-01`));
}

function parseISO(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDaysISO(value, days) {
  const date = parseISO(value);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

initializeAuth();
