(function (root) {
  'use strict';
  function courses(student, employeeId) {
    return (student?.enrollments || []).filter(e => (e.employeeIds || []).includes(employeeId)).map(e => ({
      ...e, subject: e.subject || 'Специальность',
      id: e.id || JSON.stringify([e.educationForm, e.instrument, e.subject || 'Специальность', e.className, employeeId])
    }));
  }
  function courseLabel(e) {
    return [e.subject || 'Специальность', e.instrument, e.className, e.educationForm].filter(Boolean).join(' · ');
  }
  function applyCourse(row, course) {
    if (!course) return row;
    Object.assign(row, { needsCourseSelection: false, enrollmentId: course.id, instrument: course.instrument || '', program: course.program || '',
      className: course.className || '', educationForm: course.educationForm, type: course.subject || 'Специальность' });
    return row;
  }
  function endTime(start, hours) {
    const value = Number(String(hours).replace(',', '.'));
    if (!/^\d{2}:\d{2}$/.test(start) || !Number.isFinite(value) || value <= 0) return '';
    const [h,m] = start.split(':').map(Number);
    const end = h * 60 + m + Math.round(value * 40);
    if (h > 23 || m > 59 || end >= 1440) return '';
    return `${String(Math.floor(end / 60)).padStart(2,'0')}:${String(end % 60).padStart(2,'0')}`;
  }
  function subjectLabel(record) {
    const type = record.type || 'Без предмета';
    return record.instrument && (type === 'Специальность' || type === 'Музыкальный инструмент') ? `${type}: ${record.instrument}` : type;
  }
  const api = { courses, courseLabel, applyCourse, endTime, subjectLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SchoolModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
