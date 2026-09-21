/* Pure calculations for paid lessons. Deliberately independent of person-hours. */
(function(root) {
  const {roundHours} = typeof module !== 'undefined' && module.exports ? require('./school-model.js') : root.SchoolModel;
  const grades = ['2-', '2', '2+', '3-', '3', '3+', '4-', '4', '4+', '5-', '5', '5+'];
  function newLesson(course, employeeId, date, hours) {
    return {course_id: course.id, employee_id: employeeId, lesson_date: date,
      hours: roundHours(hours), completed: false, present_student_ids: [], grades: {},
      students: course.students.map(s => ({id:s.id, name:s.name}))};
  }
  function workedHours(lessons) {
    return lessons.filter(l => l.completed && !l.deleted).reduce((total,l) => total + roundHours(l.hours), 0);
  }
  function validHours(hours) {
    const value = Number(hours);
    return Number.isFinite(value) && value > 0 && value <= 24 && roundHours(value) > 0;
  }
  function roster(course, lessons) {
    return [...new Map([...course.students, ...lessons.flatMap(l => l.students)].map(s => [s.id,s])).values()]
      .sort((a,b) => a.name.localeCompare(b.name,'ru'));
  }
  const api = {roundHours, grades, newLesson, workedHours, validHours, roster};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PaidModel = api;
})(typeof window !== 'undefined' ? window : this);
