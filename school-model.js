(function (root) {
  'use strict';
  function roundHours(value) {
    const hours = Number(String(value ?? 0).replace(',', '.'));
    return Number.isFinite(hours) ? Math.round(Math.max(0, hours) * 2) / 2 : 0;
  }
  function courses(student, employeeId) {
    return (student?.enrollments || []).filter(e => (e.employeeIds || []).includes(employeeId)).map(e => ({
      ...e, subject: e.subject || 'Специальность',
      id: e.id || JSON.stringify([e.educationForm, e.instrument, e.subject || 'Специальность', e.className, employeeId])
    }));
  }
  function courseClassLabel(e) {
    const grade = String(e.className || '').match(/^(\d+)\s*(?:кл\.?|класс)?$/i)?.[1];
    return grade && Number(e.termYears) > 0 ? `${grade}/${Number(e.termYears)}` : e.className;
  }
  function courseLabel(e) {
    return [e.subject || 'Специальность', e.instrument, courseClassLabel(e), e.educationForm].filter(Boolean).join(' · ');
  }
  function courseChoices(courses, type) {
    const wind = courses.filter(e => e.subject === 'Специальность' && ['Флейта', 'Саксофон'].includes(e.instrument));
    const simple = type === 'Специальность' && wind.length > 0;
    const items = simple ? wind : courses;
    return { simple, items: items.map(e => ({ ...e, label: simple
      ? e.instrument + (courseClassLabel(e) ? ` · ${courseClassLabel(e)}` : '')
      : courseLabel(e) })) };
  }
  function applyCourse(row, course) {
    if (!course) return row;
    Object.assign(row, { needsCourseSelection: false, enrollmentId: course.id, instrument: course.instrument || '', program: course.program || '',
      className: course.className || '', educationForm: course.educationForm, type: course.subject || 'Специальность' });
    return row;
  }
  function endTime(start, hours, durationMinutes) {
    const value = Number(String(hours).replace(',', '.'));
    if (!/^\d{2}:\d{2}$/.test(start) || !Number.isFinite(value) || value <= 0) return '';
    const [h,m] = start.split(':').map(Number);
    const minutes = durationMinutes == null ? value * 40 : Number(durationMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return '';
    const end = h * 60 + m + Math.round(minutes);
    if (h > 23 || m > 59 || end >= 1440) return '';
    return `${String(Math.floor(end / 60)).padStart(2,'0')}:${String(end % 60).padStart(2,'0')}`;
  }
  function subjectLabel(record) {
    const type = record.type || 'Без предмета';
    return record.instrument && (type === 'Специальность' || type === 'Музыкальный инструмент') ? `${type}: ${record.instrument}` : type;
  }
  function memberIds(lesson, group) {
    const ids = Array.isArray(lesson.participantIds) ? lesson.participantIds : group ? group.studentIds : lesson.participantKind === 'group' ? [] : [lesson.studentId];
    return [...new Set((ids || []).filter(id => typeof id === 'string' && id))];
  }
  function rawLessonHours(lesson) {
    // Some curricula allocate 1.5 academic hours to 55 clock minutes.
    if (lesson.academicHours != null && Number.isFinite(Number(lesson.academicHours)) && Number(lesson.academicHours) >= 0) return Number(lesson.academicHours);
    const match = String(lesson.time || '').match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
    if (match) {
      const [,h,m,eh,em] = match.map(Number);
      const minutes = (eh-h)*60+em-m;
      if (h < 24 && eh < 24 && m < 60 && em < 60 && minutes > 0) return minutes / 40;
    }
    const hours = Number(lesson.pedHours || 0) + Number(lesson.kcHours || 0);
    return Number.isFinite(hours) ? Math.max(0, hours) : 0;
  }
  function lessonHours(lesson) {
    // Round each lesson before multiplying by the roster or summing the month.
    return roundHours(rawLessonHours(lesson));
  }
  function personHours(lesson) {
    if (!Array.isArray(lesson.participantIds)) return null;
    const members = memberIds(lesson);
    if (!members.length) return null;
    // Person-hours are allocated by the lesson roster, regardless of actual attendance.
    return lessonHours(lesson) * members.length;
  }
  const api = { roundHours, courses, courseLabel, courseChoices, applyCourse, endTime, subjectLabel, memberIds, lessonHours, personHours };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SchoolModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
