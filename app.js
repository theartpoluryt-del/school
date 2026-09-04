const supabaseConfig = window.SCHOOL_SUPABASE_CONFIG;
const supabaseClient = supabaseConfig?.url && supabaseConfig?.publishableKey && window.supabase
  ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.publishableKey)
  : null;
let cloudStateId = "";
let cloudStateVersion = "";
let cloudReady = false;
let secureCloudMode = false;
let cloudSaveTimer = null;
let cloudSaveInFlight = false;
let cloudSaveQueued = false;
let currentProfile = null;
let modalReturnFocus = null;

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
const lessonTypes = ["Специальность", "Музыкальный инструмент", "Постановка голоса", "Сценическая речь", "Ансамбль", "Оркестр", "Хор", "Сольфеджио", "Концертмейстер"];
const educationForms = ["ДПП", "ДОП"];
const dopSubjectName = "Музыкальные инструменты";
const instrumentCatalog = [
  "Фортепиано", "Скрипка", "Виолончель", "Скрипка и виолончель", "Флейта",
  "Саксофон", "Кларнет", "Труба", "Ударные инструменты",
  "Аккордеон", "Баян", "Домра", "Балалайка", "Гитара", "Гитара и балалайка",
  "Хоровое пение", "Инструменты эстрадного оркестра", "Сольное пение",
  "Общее эстетическое образование", "Сольфеджио"
];

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
document.querySelector("#toggleLoginPassword").addEventListener("click", toggleLoginPassword);
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
["#adminStudentScope", "#studentInstrumentFilter", "#studentSort", "#employeeInstrumentFilter"].forEach((selector) => {
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
document.querySelector('#journalInstrument').addEventListener('change', renderJournal);
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
  if (name === "addParticipant") addScheduleFromParticipant(id, activeScheduleWeekday);
  if (name === "addScheduleDay") openScheduleModal(Number(id));
  if (name === "deleteSchedule") deleteScheduleRow(id);
  if (name === "archiveSchedule") openArchiveScheduleModal();
  if (name === "toggleScheduleArchive") toggleScheduleArchive();
  if (name === "deleteScheduleArchive") deleteScheduleArchive(id);
  if (name === "printSchedule") printSchedule();
  if (name === "deleteStudent") deleteStudent(id);
  if (name === "deleteEmployee") deleteEmployee(id);
  if (name === "deleteHoliday") deleteHoliday(id);
  if (name === "openStudentModal") openStudentModal();
  if (name === "openEmployeeModal") openEmployeeModal(id === "add" ? "" : id);
  if (name === "openGroupModal") openGroupModal();
  if (name === "assignStudent") openAssignStudentModal(id);
  if (name === "assignGroup") openAssignGroupModal(id);
  if (name === "deleteGroup") deleteGroup(id);
  if (name === "peoplePage") setPeoplePage(id);
  if (name === "openHolidayModal") openHolidayModal("");
  if (name === "openHolidayDate") openHolidayModal(id);
  if (name === "generateEmployeePassword") generateEmployeePassword(action.closest("form"));
  if (name === "toggleEmployeePassword") toggleEmployeePassword(action.closest("form"), action);
  if (name === "copyNewCredentials") copyNewCredentials();
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-modal-form]");
  if (!form) return;
  event.preventDefault();

  const type = form.dataset.modalForm;
  if (type === "student") addStudentFromModal(form);
  if (type === "employee") await addEmployeeFromModal(form);
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
    refreshModalCourses(modalParticipant.closest('form'));
    return;
  }

  if (event.target.matches('[data-modal-course]')) { applyModalCourse(event.target.closest('form')); return; }
  if (event.target.matches('[data-modal-lesson-type]')) {
    const type = event.target.value;
    refreshModalCourses(event.target.closest('form'));
    event.target.value = type;
    return;
  }
  if (event.target.matches('[data-schedule-hours]')) { changeAcademicHours(event.target); return; }

  const scheduleField = event.target.closest("[data-schedule-field]");
  if (scheduleField) updateScheduleField(scheduleField);
});

document.addEventListener("input", (event) => {
  if (event.target.matches('[data-modal-start], [data-modal-hours]')) {
    const form = event.target.closest('form');
    const end = SchoolModel.endTime(form.elements.startTime.value, form.elements.academicHours.value);
    form.elements.endTime.value = end;
    form.elements.endTime.setCustomValidity(end ? '' : 'Проверьте начало и длительность занятия');
    return;
  }
  const scheduleStudentSearch = event.target.closest("[data-schedule-student-search]");
  if (scheduleStudentSearch) {
    filterScheduleStudents(scheduleStudentSearch);
    return;
  }

  const studentSearch = event.target.closest("[data-student-picker-search]");
  if (studentSearch) {
    renderStudentPickerResults(studentSearch.closest("[data-student-picker]"));
    return;
  }

  const scheduleTime = event.target.closest("[data-schedule-time]");
  if (scheduleTime) {
    handleTimeInput(scheduleTime);
    return;
  }

  const numericInput = event.target.closest("[data-numeric-input]");
  if (numericInput) {
    numericInput.value = digitsOnly(numericInput.value);
  }
});

document.addEventListener("focusout", (event) => {
  if (event.target.matches('[data-schedule-hours]')) { changeAcademicHours(event.target); return; }
  const scheduleTime = event.target.closest("[data-schedule-time]");
  if (scheduleTime) commitScheduleTime(scheduleTime);

  const numericInput = event.target.closest("[data-numeric-input]");
  if (numericInput) updateScheduleField(numericInput);
});

document.addEventListener("beforeinput", (event) => {
  const numericTarget = event.target.closest("[data-numeric-input]");
  if (!numericTarget || !event.data) return;
  if (/\D/.test(event.data)) event.preventDefault();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !document.querySelector("#modalOverlay").classList.contains("is-hidden")) {
    closeModal();
    return;
  }
  if (event.key !== "Enter") return;
  const scheduleInput = event.target.closest(".schedule-table input, .schedule-table select");
  if (!scheduleInput) return;

  event.preventDefault();
  applyScheduleInput(scheduleInput);
  focusNextScheduleInput(scheduleInput);
});

window.addEventListener("beforeunload", (event) => {
  if (!cloudSaveTimer && !cloudSaveInFlight && !cloudSaveQueued) return;
  event.preventDefault();
  event.returnValue = "";
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
    holidays: holidaySeed.map(([date, name]) => ({ id: createId(), date, name })),
    academicPlanVersion: "2026-2027-v2"
  };
}

function createId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function uniqueByIdValues(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function uniqueTextValues(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function parseInstrumentValues(value) {
  if (Array.isArray(value)) return uniqueTextValues(value);
  return uniqueTextValues(String(value || "").split(/\s*;\s*/));
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
    const legacyRole = String(employee.role || "").trim();
    const genericRoles = ["Администратор", "Преподаватель", "Концертмейстер", "Сотрудник"];
    employee.position = employee.position || (employee.isAdmin ? "Администратор" : legacyRole === "Концертмейстер" ? "Концертмейстер" : "Преподаватель");
    const legacyInstrument = String(employee.instrument || (!genericRoles.includes(legacyRole) ? legacyRole : "")).trim();
    employee.instruments = uniqueTextValues(employee.instruments?.length ? employee.instruments : legacyInstrument ? [legacyInstrument] : []);
    employee.instrument = employee.instruments[0] || "";
    employee.role = employee.position;
  });
  data.students.forEach((student, index) => {
    student.externalId = student.externalId || `S-${String(index + 1).padStart(4, "0")}`;
    student.assignedEmployeeIds = uniqueByIdValues(student.assignedEmployeeIds || []);
    student.educationForms = uniqueTextValues(student.educationForms?.length ? student.educationForms : [normalizeEducationForm(student.educationForm)])
      .filter((form) => educationForms.includes(form));
    if (!student.educationForms.length) student.educationForms = ["ДПП"];
    student.educationForm = student.educationForms[0];
    student.instruments = uniqueTextValues(student.instruments || []);
    student.unresolvedTeacherNames = uniqueTextValues(student.unresolvedTeacherNames || []);
    student.enrollments = Array.isArray(student.enrollments) ? student.enrollments.map((enrollment) => ({
      ...enrollment,
      subject: enrollment.subject || "Специальность",
      educationForm: normalizeEducationForm(enrollment.educationForm),
      instrument: String(enrollment.instrument || "").trim(),
      className: String(enrollment.className || student.className || "").trim(),
      employeeIds: uniqueByIdValues(enrollment.employeeIds || []),
      unresolvedTeacherNames: uniqueTextValues(enrollment.unresolvedTeacherNames || [])
    })) : [];
    delete student.employeeId;
  });
  data.groups.forEach((group, index) => {
    group.externalId = group.externalId || `G-${String(index + 1).padStart(4, "0")}`;
    group.studentIds = uniqueByIdValues(group.studentIds || []);
    group.assignedEmployeeIds = uniqueByIdValues(group.assignedEmployeeIds || []);
    group.educationForm = normalizeEducationForm(group.educationForm);
    group.instruments = uniqueTextValues(group.instruments?.length ? group.instruments : group.instrument ? [group.instrument] : []);
    group.instrument = group.instruments[0] || "";
    group.unresolvedStudentNames = uniqueTextValues(group.unresolvedStudentNames || []);
    group.unresolvedTeacherNames = uniqueTextValues(group.unresolvedTeacherNames || []);
  });
  data.schedule.forEach((row) => {
    row.groupId = row.groupId || "";
    row.archiveId = row.archiveId || "";
    row.effectiveFrom = row.effectiveFrom || "2026-09-01";
    if (row.type === "Индивидуальный урок") row.type = "Специальность";
    row.time = normalizeScheduleTime(row.time) || row.time;
    row.room = digitsOnly(row.room || "");
    const courses = SchoolModel.courses(data.students.find(s => s.id === row.studentId), row.employeeId);
    if (!row.enrollmentId && courses.length === 1 && !row.archiveId && ['Специальность', 'Музыкальный инструмент'].includes(row.type)) SchoolModel.applyCourse(row, courses[0]);
  });
  const scheduleIds = new Set(data.schedule.map((row) => row.id));
  data.records = data.records.filter((record) => scheduleIds.has(record.scheduleId));
  data.records.forEach((record) => {
    const row = data.schedule.find(item => item.id === record.scheduleId);
    if (record.enrollmentId || !row?.enrollmentId || row.archiveId || !['Специальность', 'Музыкальный инструмент'].includes(record.type)) return;
    const course = SchoolModel.courses(data.students.find(student => student.id === record.studentId), record.employeeId).find(item => item.id === row.enrollmentId);
    if (course) SchoolModel.applyCourse(record, course);
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

function normalizeEmployeeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function randomCharacter(source) {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return source[value[0] % source.length];
}

function createTemporaryPassword() {
  const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%&*-_+"];
  const alphabet = groups.join("");
  const characters = groups.map(randomCharacter);
  while (characters.length < 16) characters.push(randomCharacter(alphabet));
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    const swapIndex = value[0] % (index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join("");
}

function generateEmployeePassword(form) {
  const input = form?.elements?.newPassword;
  if (!input) return;
  input.value = createTemporaryPassword();
  input.type = "text";
  const toggle = form.querySelector('[data-action="toggleEmployeePassword"]');
  if (toggle) toggle.textContent = "Скрыть";
  input.focus();
  input.select();
}

function toggleEmployeePassword(form, button) {
  const input = form?.elements?.newPassword;
  if (!input) return;
  input.type = input.type === "password" ? "text" : "password";
  button.textContent = input.type === "password" ? "Показать" : "Скрыть";
}

async function invokeCredentialUpdate(currentUsername, newUsername, newPassword) {
  if (!supabaseClient) throw new Error("Подключение к серверу не настроено.");
  const { data, error } = await supabaseClient.functions.invoke("manage-school-user", {
    body: { currentUsername, newUsername, newPassword }
  });
  if (error) {
    let message = error.message || "Не удалось обновить учётные данные.";
    try {
      const details = await error.context?.json();
      if (details?.error) message = details.error;
    } catch {
      // The generic function error is still useful when no JSON body is available.
    }
    throw new Error(message);
  }
  if (!data?.ok) throw new Error(data?.error || "Не удалось обновить учётные данные.");
  return data;
}

function openCredentialResult(employeeName, username, password) {
  openModal("Учётные данные обновлены", `
    <div class="credential-result">
      <p>Передайте новые данные сотруднику. После закрытия окна пароль больше не будет показан.</p>
      <label>Сотрудник<input type="text" value="${escapeAttr(employeeName)}" readonly /></label>
      <label>Логин<input type="text" id="newCredentialUsername" value="${escapeAttr(username)}" readonly /></label>
      <label>Новый пароль<input type="text" id="newCredentialPassword" value="${escapeAttr(password)}" readonly /></label>
      <p class="form-status" id="credentialCopyStatus" role="status"></p>
      <button class="primary-button" type="button" data-action="copyNewCredentials">Скопировать логин и пароль</button>
    </div>
  `);
}

async function copyNewCredentials() {
  const username = document.querySelector("#newCredentialUsername")?.value || "";
  const password = document.querySelector("#newCredentialPassword")?.value || "";
  const status = document.querySelector("#credentialCopyStatus");
  if (!username || !password) return;
  try {
    await navigator.clipboard.writeText(`Логин: ${username}\nПароль: ${password}`);
    if (status) status.textContent = "Логин и пароль скопированы.";
  } catch {
    if (status) status.textContent = "Не удалось скопировать автоматически. Скопируйте поля вручную.";
  }
}

async function loadCloudState() {
  if (!supabaseClient) return false;

  const secureResult = await supabaseClient.rpc("get_school_context");
  if (!secureResult.error && secureResult.data?.payload) {
    state = migrateState(secureResult.data.payload);
    cloudStateId = secureResult.data.id;
    cloudStateVersion = secureResult.data.updated_at;
    secureCloudMode = true;
    cloudReady = true;
    return true;
  }

  if (secureResult.error && !["PGRST202", "42883"].includes(secureResult.error.code)) {
    console.warn("Secure Supabase state load failed", secureResult.error.message);
    return false;
  }

  // Compatibility path while schema.sql has not yet been applied.
  const { data, error } = await supabaseClient
    .from("school_state")
    .select("id, payload, updated_at")
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
    cloudStateVersion = data.updated_at;
  } else {
    const created = await supabaseClient
      .from("school_state")
      .insert({ payload: cloudPayload() })
      .select("id, updated_at")
      .single();
    if (created.error) {
      console.warn("Supabase initial state save failed", created.error.message);
      return false;
    }
    cloudStateId = created.data.id;
    cloudStateVersion = created.data.updated_at;
  }

  secureCloudMode = false;
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
  setSyncStatus("Изменения ожидают сохранения…", "pending");
  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(flushCloudSave, 450);
}

async function flushCloudSave() {
  cloudSaveTimer = null;
  if (cloudSaveInFlight) {
    cloudSaveQueued = true;
    return;
  }

  cloudSaveInFlight = true;
  cloudSaveQueued = false;
  setSyncStatus("Сохраняем…", "pending");
  try {
    if (secureCloudMode) {
      const { data, error } = await supabaseClient.rpc("save_school_context", {
        new_payload: cloudPayload(),
        expected_updated_at: cloudStateVersion || null
      });
      if (error) {
        console.warn("Secure Supabase state save failed", error.message);
        setSyncStatus("Не удалось сохранить", "error");
        if (error.code === "40001") {
          alert("Данные уже изменены другим сотрудником. Загружена актуальная версия; повторите последнее действие.");
          await loadCloudState();
          render();
        }
        return;
      }
      cloudStateVersion = data.updated_at;
      setSyncStatus(`Сохранено в ${currentTimeLabel()}`, "saved");
      return;
    }

    const { error } = await supabaseClient
      .from("school_state")
      .update({ payload: cloudPayload() })
      .eq("id", cloudStateId);
    if (error) {
      console.warn("Supabase state save failed", error.message);
      setSyncStatus("Не удалось сохранить", "error");
      return;
    }
    setSyncStatus(`Сохранено в ${currentTimeLabel()}`, "saved");
  } finally {
    cloudSaveInFlight = false;
    if (cloudSaveQueued) window.setTimeout(flushCloudSave, 0);
  }
}

function setSyncStatus(message, kind) {
  const status = document.querySelector("#syncStatus");
  if (!status) return;
  status.textContent = message;
  status.dataset.kind = kind;
}

function currentTimeLabel() {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date());
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
    state.activeEmployeeId = visibleEmployees().find((employee) => employee.id === state.sessionEmployeeId)?.id
      || visibleEmployees()[0]?.id
      || "";
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
  const currentUsername = currentUser()?.username || currentProfile?.username || "";
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
      const importedUser = state.employees.find((employee) => employee.username === currentUsername);
      if (!importedUser) throw new Error("current user missing from backup");
      importedUser.isAdmin = Boolean(currentProfile?.is_admin);
      state.sessionEmployeeId = importedUser.id;
      state.activeEmployeeId = importedUser.id;
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
  state.activeEmployeeId = employee.id;
  event.target.reset();
  setLoginPasswordVisibility(false);
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
  cloudStateVersion = "";
  secureCloudMode = false;
  setLoginPasswordVisibility(false);
  render();
}

function toggleLoginPassword() {
  const passwordInput = document.querySelector("#loginPassword");
  setLoginPasswordVisibility(passwordInput.type === "password");
  passwordInput.focus();
}

function setLoginPasswordVisibility(isVisible) {
  const passwordInput = document.querySelector("#loginPassword");
  const toggleButton = document.querySelector("#toggleLoginPassword");
  const label = isVisible ? "Скрыть пароль" : "Показать пароль";
  passwordInput.type = isVisible ? "text" : "password";
  toggleButton.setAttribute("aria-pressed", String(isVisible));
  toggleButton.setAttribute("aria-label", label);
  toggleButton.title = label;
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
  state.activeEmployeeId = employee.id;
  render();
}

function switchTab(name) {
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  Object.entries(views).forEach(([viewName, view]) => view.classList.toggle("active", viewName === name));
  pageTitle.textContent = titles[name];
}

function openModal(title, body) {
  modalReturnFocus = document.activeElement;
  document.querySelector("#modalContent").innerHTML = `
    <div class="form-header">
      <h3>${title}</h3>
    </div>
    ${body}
  `;
  document.querySelector("#modalOverlay").classList.remove("is-hidden");
  document.body.classList.add("modal-open");
  window.requestAnimationFrame(() => {
    document.querySelector("#modalContent input:not([type='hidden']), #modalContent select, #modalContent button")?.focus();
  });
}

function closeModal() {
  document.querySelector("#modalOverlay").classList.add("is-hidden");
  document.querySelector("#modalContent").innerHTML = "";
  document.body.classList.remove("modal-open");
  if (modalReturnFocus instanceof HTMLElement) modalReturnFocus.focus();
  modalReturnFocus = null;
}

function openStudentModal() {
  if (!isAdmin()) return;
  openModal("Добавить ученика или группу", `
    <form class="modal-form" data-modal-form="student">
      <label>Название<input type="text" name="name" placeholder="Фамилия Имя или Оркестр" required /></label>
      <label>Класс<input type="text" name="className" placeholder="5/8, анс, оркестр" /></label>
      <label>Форма обучения<select name="educationForm">${educationFormOptions("ДПП")}</select></label>
      <label>Инструмент / направление<input type="text" name="instruments" list="studentInstrumentCatalog" placeholder="Например, фортепиано" /></label>
      <datalist id="studentInstrumentCatalog">${instrumentCatalog.map((instrument) => `<option value="${escapeAttr(instrument)}"></option>`).join("")}</datalist>
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
      <fieldset class="compact-fieldset">
        <legend>Формы обучения</legend>
        <div class="inline-check-list">${educationFormCheckboxes(student.educationForms || [student.educationForm])}</div>
      </fieldset>
      <label>Инструменты / направления через «;»
        <input type="text" name="instruments" value="${escapeAttr(studentInstrumentNames(student).join("; "))}" list="studentInstrumentCatalog" />
        <datalist id="studentInstrumentCatalog">${instrumentCatalog.map((instrument) => `<option value="${escapeAttr(instrument)}"></option>`).join("")}</datalist>
      </label>
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

function openEmployeeModal(employeeId) {
  if (!isAdmin()) return;
  const employee = state.employees.find((item) => item.id === employeeId);
  openModal(employee ? "Редактировать сотрудника" : "Добавить сотрудника", `
    <form class="modal-form" data-modal-form="employee" data-employee-id="${employee?.id || ""}">
      ${employee ? "" : `<p class="muted-note">Сначала создайте пользователя с адресом <strong>логин@journal.local</strong> в Supabase Authentication и профиль с тем же логином.</p>`}
      <label>ФИО<input type="text" name="name" value="${escapeAttr(employee?.name || "")}" placeholder="Иванова Анна Сергеевна" required /></label>
      <label>Должность<select name="position">${employeePositionOptions(employee?.position)}</select></label>
      <label>Инструменты / предметы через «;»
        <input type="text" name="instrument" value="${escapeAttr(employeeInstrumentNames(employee).join("; "))}" list="instrumentCatalog" placeholder="Например: фортепиано; хор" />
        <datalist id="instrumentCatalog">${instrumentCatalog.map((instrument) => `<option value="${escapeAttr(instrument)}"></option>`).join("")}</datalist>
      </label>
      <label>Логин
        <input type="text" name="username" value="${escapeAttr(employee?.username || "")}" placeholder="ivanova" pattern="[a-z0-9][a-z0-9._-]{2,31}" required />
      </label>
      ${employee ? `
        <div class="credential-editor">
          <label>Новый пароль
            <input type="password" name="newPassword" minlength="12" autocomplete="new-password" placeholder="Оставьте пустым, если менять не нужно" />
          </label>
          <div class="credential-actions">
            <button class="mini-button" type="button" data-action="generateEmployeePassword">Сгенерировать</button>
            <button class="mini-button" type="button" data-action="toggleEmployeePassword">Показать</button>
          </div>
          <p class="muted-note">Текущий пароль прочитать нельзя. После сброса новый пароль будет показан один раз.</p>
        </div>
      ` : ""}
      <label class="checkbox-label"><input type="checkbox" name="isAdmin" ${employee?.isAdmin ? "checked" : ""} />Администратор</label>
      <p class="form-status" data-credential-status role="status"></p>
      <button class="primary-button" type="submit">${employee ? "Сохранить" : "Добавить"}</button>
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
      <div class="form-grid two schedule-time-modal">
        <label>Начало<input type="time" name="startTime" step="300" data-modal-start required /></label>
        <label>Учебных часов (40 мин)<input type="text" inputmode="decimal" name="academicHours" value="1" data-modal-hours required /></label>
        <label>Окончание<input type="time" name="endTime" step="300" required /></label>
      </div>
      <label>Ученик / группа<select name="studentId" data-modal-participant>${participantOptions(participant.id)}</select></label>
      <label>Предмет<select name="type" data-modal-lesson-type>${lessonTypeOptions("Специальность")}</select></label>
      <label><span data-course-label>Предмет · инструмент · класс</span><select name="enrollmentId" data-modal-course></select></label>
      <label>Класс<input type="text" name="className" value="${escapeAttr(participant.className || "")}" data-modal-class readonly /></label>
      <p class="muted-note">Педагогические или концертмейстерские часы рассчитаются автоматически: 40 минут = 1 час.</p>
      <label>Кабинет<input type="text" inputmode="numeric" name="room" placeholder="18" data-numeric-input /></label>
      <button class="primary-button" type="submit">Добавить</button>
    </form>
  `);
  refreshModalCourses(document.querySelector('[data-modal-form="schedule"]'));
}

function courseOptionsFor(participantId, employeeId = state.activeEmployeeId) {
  return SchoolModel.courses(participantById(participantId), employeeId);
}

function courseSelectOptions(row) {
  const { simple, items } = SchoolModel.courseChoices(courseOptionsFor(row.studentId, row.employeeId), row.type);
  return `<option value="" disabled ${items.some(e => e.id === row.enrollmentId) ? '' : 'selected'}>${items.length ? (simple ? 'Выберите инструмент' : 'Выберите предмет и инструмент') : 'Нет отдельных привязок'}</option>` + items.map(e =>
    `<option value="${escapeAttr(e.id)}" ${row.enrollmentId === e.id ? 'selected' : ''}>${escapeHtml(e.label)}</option>`).join('');
}

function refreshModalCourses(form) {
  if (!form) return;
  const row = { studentId: form.elements.studentId.value, employeeId: state.activeEmployeeId, type: form.elements.type.value };
  const {simple, items: courses} = SchoolModel.courseChoices(courseOptionsFor(row.studentId), row.type);
  form.querySelector('[data-course-label]').textContent = simple ? 'Инструмент' : 'Предмет · инструмент · класс';
  row.enrollmentId = courses.some(e => e.id === form.elements.enrollmentId.value) ? form.elements.enrollmentId.value : courses.length === 1 ? courses[0].id : '';
  form.elements.enrollmentId.innerHTML = courseSelectOptions(row);
  form.elements.enrollmentId.value = row.enrollmentId;
  form.elements.enrollmentId.required = courses.length > 0;
  applyModalCourse(form);
}

function applyModalCourse(form) {
  const course = courseOptionsFor(form.elements.studentId.value).find(e => e.id === form.elements.enrollmentId.value);
  form.elements.className.value = course?.className || (courseOptionsFor(form.elements.studentId.value).length ? '' : participantById(form.elements.studentId.value)?.className || '');
  if (course) form.elements.type.value = course.subject;
}

function initializeScheduleCourse(row) {
  const courses = courseOptionsFor(row.studentId, row.employeeId);
  if (courses.length === 1) SchoolModel.applyCourse(row, courses[0]);
  else if (courses.length > 1) { row.className = ''; row.needsCourseSelection = true; }
  return row;
}

function changeAcademicHours(input) {
  const row = state.schedule.find(r => r.id === input.dataset.scheduleId);
  if (!row) return;
  const start = scheduleTimeParts(row).start;
  const value = Number(input.value.replace(',', '.'));
  if (value === row.durationHours) return;
  const end = SchoolModel.endTime(start, value);
  input.setCustomValidity(Number.isFinite(value) && value > 0 && (!start || end) ? '' : 'Введите положительное число часов, занятие должно закончиться до полуночи');
  if (!input.reportValidity()) return;
  row.durationHours = value;
  if (start) { row.time = `${start}-${end}`; updateHoursFromTime(row); }
  refreshGeneratedJournalForScheduleChange(row);
  persistAndRender();
}

function addScheduleRow(weekday) {
  const participant = visibleParticipants()[0];
  if (!participant) {
    alert("Сначала администратор должен назначить ученика или группу преподавателю.");
    return;
  }

  state.schedule.push(initializeScheduleCourse({
    id: createId(),
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
  }));
  persistAndRender();
}

function updateScheduleField(field) {
  const row = state.schedule.find((item) => item.id === field.dataset.scheduleId);
  if (!row) return;

  const key = field.dataset.scheduleField;
  if (key === 'enrollmentId') {
    const course = courseOptionsFor(row.studentId, row.employeeId).find(e => e.id === field.value);
    if (!course) return;
    SchoolModel.applyCourse(row, course);
    updateHoursFromTime(row);
    refreshGeneratedJournalForScheduleChange(row);
    persistAndRender();
    return;
  }
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

  refreshGeneratedJournalForScheduleChange(row);
  persistAndRender();
}

function handleTimeInput(input) {
  const wrapper = input.closest(".time-pair");
  if (!wrapper) return;
  const startInput = wrapper.querySelector('[data-time-bound="start"]');
  const endInput = wrapper.querySelector('[data-time-bound="end"]');
  if (input === startInput && startInput.value) {
    const row = state.schedule.find((item) => item.id === input.dataset.scheduleId);
    endInput.value = SchoolModel.endTime(startInput.value, row?.durationHours || Number(row?.pedHours || 0) + Number(row?.kcHours || 0) || 1);
  }
  validateScheduleTimePair(wrapper);
}

function employeePositionOptions(selectedPosition) {
  return ["Преподаватель", "Концертмейстер", "Администратор"]
    .map((position) => `<option value="${position}" ${position === selectedPosition ? "selected" : ""}>${position}</option>`)
    .join("");
}

function commitScheduleTime(input) {
  const row = state.schedule.find((item) => item.id === input.dataset.scheduleId);
  const wrapper = input.closest(".time-pair");
  if (!row || !wrapper) return;
  const startInput = wrapper.querySelector('[data-time-bound="start"]');
  const endInput = wrapper.querySelector('[data-time-bound="end"]');
  if (!startInput.value || !endInput.value || !validateScheduleTimePair(wrapper)) return;

  row.time = `${startInput.value}-${endInput.value}`;
  row.durationHours = (minutesFromTime(endInput.value) - minutesFromTime(startInput.value)) / 40;
  updateHoursFromTime(row);
  refreshGeneratedJournalForScheduleChange(row);
  refreshCalculatedHourInputs(wrapper, row);
  reorderScheduleRows(wrapper.closest("tbody"));
  queueCloudSave();
}

function validateScheduleTimePair(wrapper) {
  const startInput = wrapper.querySelector('[data-time-bound="start"]');
  const endInput = wrapper.querySelector('[data-time-bound="end"]');
  const complete = Boolean(startInput.value && endInput.value);
  const valid = !complete || minutesFromTime(endInput.value) > minutesFromTime(startInput.value);
  const message = valid ? "" : "Окончание должно быть позже начала";
  endInput.setCustomValidity(message);
  endInput.setAttribute("aria-invalid", String(!valid));
  wrapper.classList.toggle("has-error", !valid);
  return valid;
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
  if (input.matches('[data-schedule-hours]')) { changeAcademicHours(input); return; }
  if (input.matches("[data-schedule-time]")) {
    commitScheduleTime(input);
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
    id: createId(),
    name: document.querySelector("#studentName").value.trim(),
    className: document.querySelector("#studentClass").value.trim(),
    externalId: nextStudentExternalId(),
    educationForm: "ДПП",
    educationForms: ["ДПП"],
    instruments: [],
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
    id: createId(),
    externalId,
    name: form.elements.name.value.trim(),
    className: form.elements.className.value.trim(),
    educationForm: normalizeEducationForm(form.elements.educationForm.value),
    educationForms: [normalizeEducationForm(form.elements.educationForm.value)],
    instruments: parseInstrumentValues(form.elements.instruments.value),
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
    id: createId(),
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
  student.educationForms = uniqueTextValues(checkedValues(form, "educationForms")).filter((value) => educationForms.includes(value));
  if (!student.educationForms.length) student.educationForms = ["ДПП"];
  student.educationForm = student.educationForms[0];
  student.instruments = parseInstrumentValues(form.elements.instruments.value);
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
    id: createId(),
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

async function addEmployeeFromModal(form) {
  if (!isAdmin()) return;
  const username = normalizeEmployeeUsername(form.elements.username.value);
  let existing = state.employees.find((employee) => employee.id === form.dataset.employeeId);
  const existingId = existing?.id || "";
  const previousUsername = existing?.username || "";
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    alert("Логин должен содержать 3–32 латинских символа: буквы, цифры, точку, дефис или подчёркивание.");
    return;
  }
  if (state.employees.some((employee) => employee.id !== existing?.id && employee.username === username)) {
    alert("Такой логин уже используется.");
    return;
  }

  const newPassword = existing ? form.elements.newPassword.value : "";
  const credentialsChanged = Boolean(existing && (username !== previousUsername || newPassword));
  const submitButton = form.querySelector('button[type="submit"]');
  const status = form.querySelector("[data-credential-status]");
  if (credentialsChanged) {
    submitButton.disabled = true;
    if (status) status.textContent = "Обновляем логин и пароль на сервере…";
    try {
      const result = await invokeCredentialUpdate(previousUsername, username, newPassword);
      if (result.updatedAt) {
        cloudStateVersion = result.updatedAt;
        if (!await loadCloudState()) throw new Error("Логин изменён, но список не обновился. Перезагрузите страницу.");
        existing = state.employees.find((employee) => employee.id === existingId);
        if (!existing) throw new Error("Обновлённая карточка сотрудника не найдена. Перезагрузите страницу.");
      }
    } catch (error) {
      submitButton.disabled = false;
      if (status) status.textContent = error.message;
      return;
    }
  }

  const employee = existing || { id: createId(), username };
  employee.name = form.elements.name.value.trim();
  employee.username = username;
  employee.position = form.elements.position.value;
  employee.instruments = parseInstrumentValues(form.elements.instrument.value);
  employee.instrument = employee.instruments[0] || "";
  employee.role = employee.position;
  employee.isAdmin = form.elements.isAdmin.checked;
  if (currentProfile?.username === previousUsername) currentProfile.username = username;
  if (!existing) state.employees.push(employee);
  if (!employee.isAdmin) state.activeEmployeeId = employee.id;
  closeModal();
  persistAndRender();
  if (newPassword) openCredentialResult(employee.name, username, newPassword);
}

function addHoliday(event) {
  event.preventDefault();
  if (!isAdmin()) return;
  state.holidays.push({
    id: createId(),
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
      id: createId(),
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

  const start = form.elements.startTime.value;
  const end = form.elements.endTime.value;
  if (!start || !end || minutesFromTime(end) <= minutesFromTime(start)) {
    form.elements.endTime.setCustomValidity("Окончание должно быть позже начала");
    form.elements.endTime.reportValidity();
    return;
  }

  const row = {
    id: createId(),
    employeeId: state.activeEmployeeId,
    effectiveFrom: currentScheduleEffectiveFrom(),
    effectiveTo: "",
    archiveId: "",
    weekday: Number(form.dataset.weekday),
    time: `${start}-${end}`,
    studentId: form.elements.studentId.value,
    groupId: "",
    className: participant.className || "",
    type: form.elements.type.value,
    pedHours: 0,
    kcHours: 0,
    room: digitsOnly(form.elements.room.value)
  };
  const course = courseOptionsFor(participant.id).find(e => e.id === form.elements.enrollmentId.value);
  if (courseOptionsFor(participant.id).length && !course) { form.elements.enrollmentId.reportValidity(); return; }
  SchoolModel.applyCourse(row, course);
  row.durationHours = (minutesFromTime(end) - minutesFromTime(start)) / 40;
  updateHoursFromTime(row);
  state.schedule.push(row);
  closeModal();
  persistAndRender();
}

function closeScheduleRow(id) {
  const row = state.schedule.find((item) => item.id === id);
  if (!row) return;
  row.effectiveTo = row.effectiveTo || todayISO();
  refreshGeneratedJournalForScheduleChange(row);
  persistAndRender();
}

function deleteScheduleRow(id) {
  const hasRecords = state.records.some((record) => record.scheduleId === id);
  if (hasRecords && !confirm("По этой строке уже есть записи журнала. Удалить занятие вместе со связанными записями журнала?")) {
    return;
  }
  state.schedule = state.schedule.filter((item) => item.id !== id);
  state.records = state.records.filter((record) => record.scheduleId !== id);
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

  const archiveId = createId();
  const effectiveFrom = currentScheduleEffectiveFrom();
  const nextVersionStart = addDaysISO(archivedThrough, 1);
  const archivedRowIds = new Set(currentRows.map((row) => row.id));
  const affectedJournalMonths = [...new Set(state.records
    .filter((record) => archivedRowIds.has(record.scheduleId) && record.date > archivedThrough)
    .map((record) => record.date.slice(0, 7)))];
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
    id: createId(),
    archiveId: "",
    effectiveFrom: nextVersionStart,
    effectiveTo: ""
  }));

  currentRows.forEach((row) => {
    row.archiveId = archiveId;
    row.effectiveTo = archivedThrough;
  });
  state.schedule.push(...nextVersionRows);
  affectedJournalMonths.forEach((month) => refreshJournalMonth(month, todayISO(), state.activeEmployeeId));
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
  const result = refreshJournalMonth(month, asOf, state.activeEmployeeId);

  alert(result.created || result.removed
    ? `Журнал обновлён. Создано записей: ${result.created}. Заменено плановых записей: ${result.removed}.`
    : "Журнал уже актуален. Проведённые уроки и выставленные оценки сохранены.");
  persistAndRender();
}

function refreshJournalMonth(month, asOf, employeeId) {
  const dates = monthDates(month);
  const previousRecords = state.records.filter((record) => record.employeeId === employeeId && record.date.startsWith(month));
  const removed = previousRecords.length;
  const reusedRecordIds = new Set();
  state.records = state.records.filter((record) => !(
    record.employeeId === employeeId
    && record.date.startsWith(month)
  ));
  let created = 0;

  dates.forEach((date) => {
    if (isHoliday(date)) return;
    const dateObj = parseISO(date);
    activeScheduleForEmployeeDate(employeeId, date).forEach((row) => {
      if (dateObj.getDay() !== row.weekday || row.needsCourseSelection) return;
      const previous = previousRecords.find((record) => (
        !reusedRecordIds.has(record.id)
        && record.date === date
        && (
          (record.scheduleId === row.id && record.studentId === row.studentId && (!record.enrollmentId || record.enrollmentId === row.enrollmentId))
          || (
            record.studentId === row.studentId
            && record.time === row.time
            && record.type === row.type
            && (record.instrument || '') === (row.instrument || '')
            && record.className === row.className
          )
        )
      ));
      if (previous) reusedRecordIds.add(previous.id);
      state.records.push({
        id: previous?.id || createId(),
        employeeId: row.employeeId,
        scheduleId: row.id,
        date,
        time: row.time,
        studentId: row.studentId,
        studentName: studentName(row.studentId),
        className: row.className,
        educationForm: row.educationForm || educationFormForParticipant(row.studentId),
        enrollmentId: row.enrollmentId || '',
        instrument: row.instrument || '',
        program: row.program || '',
        type: row.type,
        pedHours: row.pedHours,
        kcHours: row.kcHours,
        grade: previous?.grade || "",
        status: previous?.status === "conducted" || date <= asOf ? "conducted" : "planned"
      });
      created += 1;
    });
  });

  return { created, removed };
}

function refreshGeneratedJournalForScheduleChange(row) {
  const months = [...new Set(state.records
    .filter((record) => record.scheduleId === row.id)
    .map((record) => record.date.slice(0, 7)))];
  months.forEach((month) => refreshJournalMonth(month, todayISO(), row.employeeId));
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
    ? `${employee.position}${employee.instrument ? ` · ${employee.instrument}` : ""} · 2026-2027 учебный год`
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
      <div class="lesson-when">
        <strong>${formatDate(item.date)}</strong>
        <span>Время: <b>${escapeHtml(item.time)}</b></span>
      </div>
      <div class="lesson-details">
        <b>${escapeHtml(item.studentName)}</b>
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
          <span class="day-name-full">${weekdays[weekday]}</span>
          <span class="day-name-short">${weekdays[weekday].slice(0, 2)}</span>
        </button>
      `).join("")}
    </div>
    <div class="schedule-workspace">
      <section class="schedule-roster">
        <div class="schedule-roster-header">
          <h3>\u0414\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0435 \u0443\u0447\u0435\u043d\u0438\u043a\u0438</h3>
          <p data-schedule-student-count>${students.length} \u0443\u0447.</p>
        </div>
        ${students.length ? `
          <div class="schedule-roster-search">
            <label>
              Найти ученика
              <input type="search" placeholder="Начните вводить фамилию" autocomplete="off" data-schedule-student-search />
            </label>
          </div>
        ` : ""}
        <div class="schedule-student-list">
          ${students.length ? `${students.map(renderDraggableStudent).join("")}<div class="schedule-search-empty is-hidden" data-schedule-search-empty>Ученики не найдены.</div>` : `<div class="empty-state">\u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440 \u0435\u0449\u0435 \u043d\u0435 \u043d\u0430\u0437\u043d\u0430\u0447\u0438\u043b \u0443\u0447\u0435\u043d\u0438\u043a\u043e\u0432.</div>`}
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
    <button class="schedule-student-chip" type="button" draggable="true" data-drag-participant="${student.id}" data-schedule-student-name="${escapeAttr(student.name.toLocaleLowerCase("ru"))}" data-action="addParticipant:${student.id}" aria-label="Добавить ${escapeAttr(student.name)} в ${escapeAttr(weekdays[activeScheduleWeekday])}">
      <strong>${escapeHtml(student.name)}</strong>
      <span>${escapeHtml(studentClassLabel(student, state.activeEmployeeId) || "без класса")}</span>
    </button>
  `;
}

function filterScheduleStudents(input) {
  const roster = input.closest(".schedule-roster");
  if (!roster) return;

  const query = input.value.trim().toLocaleLowerCase("ru");
  const students = [...roster.querySelectorAll("[data-schedule-student-name]")];
  let visibleCount = 0;

  students.forEach((student) => {
    const matches = !query || student.dataset.scheduleStudentName.includes(query);
    student.classList.toggle("is-hidden", !matches);
    if (matches) visibleCount += 1;
  });

  const count = roster.querySelector("[data-schedule-student-count]");
  if (count) count.textContent = query ? `${visibleCount} из ${students.length}` : `${students.length} уч.`;
  roster.querySelector("[data-schedule-search-empty]")?.classList.toggle("is-hidden", visibleCount > 0);
}

function renderDraggableGroup(group) {
  return `
    <button class="schedule-student-chip group-chip" type="button" draggable="true" data-drag-participant="${group.id}" data-action="addParticipant:${group.id}" aria-label="Добавить ${escapeAttr(group.name)} в ${escapeAttr(weekdays[activeScheduleWeekday])}">
      <strong>${escapeHtml(group.name)}</strong>
      <span>${escapeHtml(group.className || "\u0433\u0440\u0443\u043f\u043f\u0430")}</span>
    </button>
  `;
}

function renderScheduleRow(row) {
  const participant = participantById(row.studentId);
  const time = scheduleTimeParts(row);
  const simple = SchoolModel.courseChoices(courseOptionsFor(row.studentId, row.employeeId), row.type).simple;
  const courseSelect = `<select class="schedule-course-select" aria-label="${simple ? 'Инструмент' : 'Предмет, инструмент и класс'}" data-schedule-id="${escapeAttr(row.id)}" data-schedule-field="enrollmentId">${courseSelectOptions(row)}</select>`;
  return `
    <tr class="${row.effectiveTo ? "closed" : ""}" data-schedule-row="${row.id}">
      <td class="schedule-time-cell" data-label="Время">
        <span class="time-pair">
          <input class="schedule-time-input" type="time" value="${escapeAttr(time.start)}" step="300" aria-label="Начало занятия" data-schedule-id="${row.id}" data-schedule-time data-time-bound="start" />
          <span class="time-dash">-</span>
          <input class="schedule-time-input" type="time" value="${escapeAttr(time.end)}" step="300" aria-label="Окончание занятия" data-schedule-id="${row.id}" data-schedule-time data-time-bound="end" />
        </span>
        <label class="academic-hours-label">Уч. часов<input type="text" inputmode="decimal" value="${escapeAttr(row.durationHours || Number(row.pedHours || 0) + Number(row.kcHours || 0) || 1)}" data-schedule-hours data-schedule-id="${escapeAttr(row.id)}" aria-label="Учебных часов по 40 минут" /></label>
      </td>
      <td class="participant-cell" data-label="Ученик / группа"><strong>${escapeHtml(participant?.name || "Не найдено")}</strong>${simple ? '' : courseSelect}</td>
      <td class="class-cell" data-label="Класс">${escapeHtml(row.className || (courseOptionsFor(row.studentId, row.employeeId).length ? 'Выберите предмет' : participant?.className || ""))}</td>
      <td class="schedule-type-cell" data-label="Предмет"><select class="type-input" aria-label="Предмет" data-schedule-id="${row.id}" data-schedule-field="type">${lessonTypeOptions(row.type)}</select>${simple ? courseSelect : ''}</td>
      <td class="schedule-ped-cell" data-label="Пед."><input class="hours-input calculated-hours" type="text" value="${escapeAttr(row.pedHours)}" data-schedule-field="pedHours" readonly tabindex="-1" /></td>
      <td class="schedule-kc-cell" data-label="Кц"><input class="hours-input calculated-hours" type="text" value="${escapeAttr(row.kcHours)}" data-schedule-field="kcHours" readonly tabindex="-1" /></td>
      <td class="schedule-room-cell" data-label="Кабинет"><input class="room-input" type="text" inputmode="numeric" value="${escapeAttr(digitsOnly(row.room || ""))}" data-numeric-input data-schedule-id="${row.id}" data-schedule-field="room" /></td>
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

function deleteScheduleArchive(id) {
  if (!isAdmin()) return;
  const archive = (state.scheduleArchives || []).find((item) => item.id === id);
  if (!archive || archive.employeeId !== state.activeEmployeeId) return;

  const archivedRows = state.schedule.filter((row) => row.archiveId === archive.id);
  const period = archivePeriodLabel(archive, archivedRows);
  if (!confirm(`Удалить архив расписания ${period} вместе со связанными записями журнала?`)) return;

  const archivedRowIds = new Set(archivedRows.map((row) => row.id));
  state.scheduleArchives = state.scheduleArchives.filter((item) => item.id !== archive.id);
  state.schedule = state.schedule.filter((row) => row.archiveId !== archive.id);
  state.records = state.records.filter((record) => !archivedRowIds.has(record.scheduleId));
  persistAndRender();
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
            <div class="schedule-archive-version-header">
              <h4>${escapeHtml(archive.title || "Архивная версия")}: ${archivePeriodLabel(archive, rows)} - ${escapeHtml(weekdays[activeScheduleWeekday])}</h4>
              <button class="danger-button" type="button" data-action="deleteScheduleArchive:${escapeAttr(archive.id)}">Удалить архив</button>
            </div>
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
  state.schedule.push(initializeScheduleCourse({
    id: createId(),
    employeeId: state.activeEmployeeId,
    effectiveFrom: currentScheduleEffectiveFrom(),
    effectiveTo: "",
    archiveId: "",
    weekday,
    time: "",
    studentId: participant.id,
    groupId: "",
    className: participant.className || "",
    type: participant.kind === "group" && participant.name === "\u041e\u0440\u043a\u0435\u0441\u0442\u0440" ? "\u041e\u0440\u043a\u0435\u0441\u0442\u0440" : "\u0421\u043f\u0435\u0446\u0438\u0430\u043b\u044c\u043d\u043e\u0441\u0442\u044c",
    pedHours: 1,
    kcHours: 0,
    room: ""
  }));
  persistAndRender();
}

function renderJournal() {
  const month = document.querySelector("#journalMonth").value;
  const monthRecords = employeeRecords().filter((record) => record.date.startsWith(month) && !isHoliday(record.date));
  const filter = document.querySelector('#journalInstrument');
  const selectedInstrument = filter.value;
  const instruments = uniqueTextValues(monthRecords.map(r => r.instrument)).sort((a,b) => a.localeCompare(b,'ru'));
  filter.innerHTML = '<option value="">Все инструменты</option>' + instruments.map(instrument => `<option value="${escapeAttr(instrument)}">${escapeHtml(instrument)}</option>`).join('');
  filter.value = instruments.includes(selectedInstrument) ? selectedInstrument : '';
  const records = monthRecords.filter(r => !filter.value || r.instrument === filter.value);
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
    const grade = String(record.grade ?? "");
    return `
      <span class="grade-control"><span class="grade-value" aria-hidden="true">${escapeHtml(grade || '•')}</span><select class="grade-select" aria-label="Оценка ${escapeAttr(entry.name)} за ${escapeAttr(date)}" title="${escapeHtml(record.time)} ${escapeHtml(SchoolModel.subjectLabel(record))} · ${formatNumber(record.pedHours)} пед. / ${formatNumber(record.kcHours)} конц." data-grade-record="${record.id}">
        ${gradeOptions(grade)}
      </select></span>
    `;
  }).join("");

  return `<td class="${dayRecords[0].status}-col"><div class="cell-stack">${buttons}</div></td>`;
}

function journalSections(records) {
  const entries = new Map();

  records.forEach((record) => {
    const educationForm = normalizeEducationForm(record.educationForm || educationFormForParticipant(record.studentId));
    const subject = SchoolModel.subjectLabel(record);
    const key = [educationForm, subject, record.studentId, record.className].join("|");
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

  const adminStudentScope = document.querySelector("#adminStudentScope");
  const adminStudentScopeLabel = document.querySelector("#adminStudentScopeLabel");
  const adminStudentScopeText = document.querySelector("#adminStudentScopeText");
  const studentInstrumentFilter = document.querySelector("#studentInstrumentFilter");
  const studentSort = document.querySelector("#studentSort");
  const employeeInstrumentFilter = document.querySelector("#employeeInstrumentFilter");
  const searchInput = document.querySelector("#studentSearch");
  const employeeSearchInput = document.querySelector("#employeeSearch");

  refreshSelect(studentInstrumentFilter, instrumentOptions(studentInstrumentFilter?.value || ""), studentInstrumentFilter?.value || "");
  refreshSelect(employeeInstrumentFilter, instrumentOptions(employeeInstrumentFilter?.value || ""), employeeInstrumentFilter?.value || "");
  adminStudentScopeLabel?.classList.toggle("is-hidden", !isAdmin());

  const selectedTeacherId = isAdmin() && adminStudentScope?.checked ? state.activeEmployeeId : isAdmin() ? "" : state.sessionEmployeeId;
  const selectedTeacher = state.employees.find((employee) => employee.id === state.activeEmployeeId);
  if (adminStudentScopeText) {
    adminStudentScopeText.textContent = selectedTeacherId ? `Ученики: ${selectedTeacher?.name || "выбранный преподаватель"}` : "Все ученики";
  }
  const scopeHint = adminStudentScopeLabel?.querySelector("small");
  if (scopeHint) scopeHint.textContent = selectedTeacherId ? "Показать всех учеников" : "Показать только учеников выбранного преподавателя";
  const selectedStudentInstrument = studentInstrumentFilter?.value || "";
  const selectedStudentSort = studentSort?.value || "name";
  const selectedEmployeeInstrument = employeeInstrumentFilter?.value || "";
  const studentSearch = normalizeText(searchInput?.value || "");
  const employeeSearch = normalizeText(employeeSearchInput?.value || "");
  const teacherMatches = (ids) => !selectedTeacherId || (ids || []).includes(selectedTeacherId);

  const studentSource = (isAdmin() ? state.students : visibleStudents()).filter((student) => !student.isArchived);
  const groupSource = isAdmin() ? state.groups : visibleGroups();
  const students = studentSource
    .filter((student) => teacherMatches(student.assignedEmployeeIds))
    .filter((student) => matchesStudentInstrument(student, selectedStudentInstrument))
    .filter((student) => !studentSearch || normalizeText(student.name).includes(studentSearch))
    .sort((a, b) => compareStudents(a, b, selectedStudentSort));
  const groups = groupSource
    .filter((group) => teacherMatches(group.assignedEmployeeIds))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const employees = state.employees
    .filter((employee) => isAdmin() || employee.id === state.sessionEmployeeId)
    .filter((employee) => !selectedEmployeeInstrument || employeeInstrumentNames(employee).includes(selectedEmployeeInstrument))
    .filter((employee) => !employeeSearch || normalizeText(employee.name).includes(employeeSearch))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  const studentPage = paginate(students, "students");
  const groupPage = paginate(groups, "groups");
  const employeePage = paginate(employees, "employees");

  document.querySelector("#studentsList").innerHTML = studentPage.items.map((student) => `
    <article class="person-card compact-person-card">
      <div>
        <h3>${escapeHtml(student.name)}</h3>
        <p>${escapeHtml(studentClassLabel(student, selectedTeacherId) || "без класса")}</p>
        <p>\u0424\u043e\u0440\u043c\u0430: ${escapeHtml(studentEducationForms(student).join(", "))}</p>
        <p>\u0418\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442: ${escapeHtml(studentInstrumentNames(student).join(", ") || "\u043d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d")}</p>
        <p>${isAdmin() ? `\u041f\u0440\u0435\u043f\u043e\u0434\u0430\u0432\u0430\u0442\u0435\u043b\u044c: ${assignedTeacherNames(student.assignedEmployeeIds || [])}` : "\u041f\u0440\u0435\u043f\u043e\u0434\u0430\u0432\u0430\u0442\u0435\u043b\u044c: \u0432\u044b"}</p>
        ${isAdmin() && student.unresolvedTeacherNames?.length ? `<p class="warning-note">Не сопоставлены: ${escapeHtml(student.unresolvedTeacherNames.join(", "))}</p>` : ""}
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
        ${group.instrument ? `<p>Направление: ${escapeHtml(group.instrument)}</p>` : ""}
        <p>Состав: ${group.studentIds.length} уч.</p>
        <p class="line-clamp">${group.studentIds.map(studentName).map(escapeHtml).join(", ") || "\u0421\u043f\u0438\u0441\u043e\u043a \u0443\u0447\u0435\u043d\u0438\u043a\u043e\u0432 \u043f\u0443\u0441\u0442"}</p>
        <p>${isAdmin() ? `\u041f\u0440\u0435\u043f\u043e\u0434\u0430\u0432\u0430\u0442\u0435\u043b\u044c: ${assignedTeacherNames(group.assignedEmployeeIds || [])}` : "\u041f\u0440\u0435\u043f\u043e\u0434\u0430\u0432\u0430\u0442\u0435\u043b\u044c: \u0432\u044b"}</p>
        ${isAdmin() && group.unresolvedStudentNames?.length ? `<p class="warning-note">Не найдены ученики: ${escapeHtml(group.unresolvedStudentNames.join(", "))}</p>` : ""}
        ${isAdmin() && group.unresolvedTeacherNames?.length ? `<p class="warning-note">Не найдены преподаватели: ${escapeHtml(group.unresolvedTeacherNames.join(", "))}</p>` : ""}
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
        <p>${escapeHtml(employee.position || "Сотрудник")} · ${escapeHtml(employeeInstrument(employee) || "инструмент не указан")} · Логин: ${escapeHtml(employee.username)}</p>
      </div>
      <footer>
        <span class="tag">${employee.id === state.activeEmployeeId ? "\u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0439" : "\u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a"}</span>
        ${isAdmin() ? `<span class="card-actions"><button class="mini-button" type="button" data-action="openEmployeeModal:${employee.id}">Изменить</button><button class="danger-button" type="button" data-action="deleteEmployee:${employee.id}">\u0423\u0434\u0430\u043b\u0438\u0442\u044c</button></span>` : ""}
      </footer>
    </article>
  `).join("") || `<div class="empty-state">\u0421\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0438 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u044b.</div>`;
  document.querySelector("#employeesPagination").innerHTML = renderPagination("employees", employeePage.totalPages, employeePage.page, employees.length);
}

function instrumentOptions(selectedValue) {
  const instruments = uniqueTextValues([
    ...state.employees.filter(isTeachingEmployee).flatMap(employeeInstrumentNames),
    ...state.students.filter((student) => !student.isArchived).flatMap(studentInstrumentNames)
  ]).sort((a, b) => a.localeCompare(b, "ru"));
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
  return employeeInstrumentNames(employee).join(", ");
}

function employeeInstrumentNames(employee) {
  if (!employee) return [];
  return uniqueTextValues(employee.instruments?.length ? employee.instruments : employee.instrument ? [employee.instrument] : []);
}

function studentInstrumentNames(student) {
  const explicit = uniqueTextValues(student?.instruments || []);
  if (explicit.length) return explicit.sort((a, b) => a.localeCompare(b, "ru"));
  return [...new Set((student?.assignedEmployeeIds || [])
    .map((id) => state.employees.find((employee) => employee.id === id))
    .filter(Boolean)
    .flatMap(employeeInstrumentNames)
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
}

function matchesStudentInstrument(student, instrument) {
  if (!instrument) return true;
  return studentInstrumentNames(student).includes(instrument);
}

function studentEducationForms(student) {
  return uniqueTextValues(student?.educationForms?.length ? student.educationForms : [normalizeEducationForm(student?.educationForm)]);
}

function studentClassLabel(student, employeeId = isAdmin() ? '' : state.sessionEmployeeId) {
  const enrollments = (Array.isArray(student?.enrollments) ? student.enrollments : []).filter(e => !employeeId || (e.employeeIds || []).includes(employeeId));
  const labels = uniqueTextValues(enrollments.map((entry) => {
    const prefix = `${[entry.subject, entry.instrument].filter(Boolean).join(' · ')}: `;
    return entry.className ? `${prefix}${entry.className}` : "";
  }));
  return labels.length ? labels.join("; ") : String(student?.className || "");
}

function compareStudents(first, second, sortMode) {
  const nameCompare = first.name.localeCompare(second.name, "ru");
  if (sortMode === "instrument") {
    return studentInstrumentNames(first).join(" / ").localeCompare(studentInstrumentNames(second).join(" / "), "ru") || nameCompare;
  }
  if (sortMode === "teacher") {
    return assignedTeacherNames(first.assignedEmployeeIds || []).localeCompare(assignedTeacherNames(second.assignedEmployeeIds || []), "ru") || nameCompare;
  }
  if (sortMode === "class") {
    const firstClass = Number(studentClassLabel(first).match(/\d+/)?.[0] || Number.MAX_SAFE_INTEGER);
    const secondClass = Number(studentClassLabel(second).match(/\d+/)?.[0] || Number.MAX_SAFE_INTEGER);
    return firstClass - secondClass || nameCompare;
  }
  return nameCompare;
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

function isTeachingEmployee(employee) {
  return Boolean(employee) && employee.position !== "Администратор";
}

function visibleEmployees() {
  if (!isAdmin()) return currentUser() ? [currentUser()] : [];
  const teachers = state.employees.filter(isTeachingEmployee);
  const sessionEmployee = currentUser();
  if (sessionEmployee && !teachers.some((employee) => employee.id === sessionEmployee.id)) {
    teachers.unshift(sessionEmployee);
  }
  return teachers.length ? teachers : state.employees;
}

function visibleStudents() {
  if (isAdmin()) {
    return state.students.filter((student) => !student.isArchived && (student.assignedEmployeeIds || []).includes(state.activeEmployeeId));
  }
  return state.students.filter((student) => !student.isArchived && (student.assignedEmployeeIds || []).includes(state.sessionEmployeeId));
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
  return activeScheduleForEmployeeDate(state.activeEmployeeId, date);
}

function activeScheduleForEmployeeDate(employeeId, date) {
  return state.schedule.filter((row) => (
    row.employeeId === employeeId
    && row.effectiveFrom <= date
    && (!row.effectiveTo || row.effectiveTo >= date)
  ));
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
    const iso = localDateISO(date);
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
  const { start } = splitScheduleTime(row.time);
  return start ? minutesFromTime(start) : Number.MAX_SAFE_INTEGER;
}

function studentOptions(selectedId) {
  return visibleStudents().map((student) => {
    const selected = student.id === selectedId ? "selected" : "";
    const classLabel = studentClassLabel(student);
    const suffix = classLabel ? `, ${classLabel}` : "";
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
  const start = normalizeTimePoint(startSource);
  const end = normalizeTimePoint(endSource);
  return {
    start,
    end
  };
}

function normalizeScheduleTime(value) {
  const { start, end } = splitScheduleTime(value);
  return start && end && minutesFromTime(end) > minutesFromTime(start) ? `${start}-${end}` : "";
}

function normalizeTimePoint(value) {
  const source = String(value || "").trim();
  const match = source.match(/^(\d{1,2})\D(\d{1,2})$/);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function scheduleTimeParts(row) {
  const parts = splitScheduleTime(row.time);
  if (!parts.end && parts.start) {
    parts.end = addMinutesToTime(parts.start, (Number(row.pedHours || 0) + Number(row.kcHours || 0)) * 40);
  }
  return parts;
}

function addMinutesToTime(time, minutesToAdd) {
  const normalized = normalizeTimePoint(time);
  if (!normalized) return "";
  const total = (minutesFromTime(normalized) + Number(minutesToAdd || 0)) % (24 * 60);
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
  if (!parts.start || !parts.end) return null;
  const start = minutesFromTime(parts.start);
  const end = minutesFromTime(parts.end);
  if (end <= start) return null;
  const duration = end - start;
  return Number((duration / 40).toFixed(2));
}

function minutesFromTime(value) {
  const normalized = normalizeTimePoint(value);
  if (!normalized) return Number.NaN;
  return Number(normalized.slice(0, 2)) * 60 + Number(normalized.slice(3, 5));
}

function gradeOptions(selectedGrade) {
  selectedGrade = String(selectedGrade ?? '');
  return ["", "2-", "2", "2+", "3-", "3", "3+", "4-", "4", "4+", "5-", "5", "5+"]
    .map((grade) => `<option value="${grade}" ${grade === selectedGrade ? "selected" : ""}>${grade || "•"}</option>`)
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
    .filter(isTeachingEmployee)
    .map((employee) => `
      <label class="checkbox-label">
        <input type="checkbox" name="employeeIds" value="${employee.id}" ${selectedIds.includes(employee.id) ? "checked" : ""} />
        ${escapeHtml(employee.name)}${employeeInstrument(employee) ? ` · ${escapeHtml(employeeInstrument(employee))}` : ""}
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
      ${escapeHtml(student.name)} · ${escapeHtml(studentClassLabel(student) || "без класса")}
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
    .filter((student) => !student.isArchived)
    .filter((student) => normalizeText(student.name).includes(query))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
    .slice(0, 20);

  results.innerHTML = matches.length ? matches.map((student) => `
    <label class="checkbox-label">
      <input type="checkbox" data-student-picker-choice value="${student.id}" ${selected.includes(student.id) ? "checked" : ""} />
      ${escapeHtml(student.name)} · ${escapeHtml(studentClassLabel(student) || "без класса")}
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

function educationFormCheckboxes(selectedForms) {
  const selected = new Set(uniqueTextValues(selectedForms));
  return educationForms.map((form) => `
    <label class="checkbox-label">
      <input type="checkbox" name="educationForms" value="${form}" ${selected.has(form) ? "checked" : ""} />
      ${form}
    </label>
  `).join("");
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
  return localDateISO(new Date());
}

function localDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
