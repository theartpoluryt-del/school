-- Import collective classes from "Контингент с преподавателями.docx" (01.09.2026).
-- Safe to rerun: only groups with the GRP-2026-* external IDs are replaced.

begin;

with group_seed as (
  select *
  from jsonb_to_recordset($seed$
  [
    {
      "external_id": "GRP-2026-CHOIR-01",
      "name": "Хоровое пение — 1 класс",
      "class_name": "1 класс · 8-летний срок обучения",
      "education_form": "ДПП",
      "instrument": "Хоровое пение",
      "teachers": ["Чебакова Елена Викторовна"],
      "students": ["Власова Елизавета", "Гурвич Надежда", "Долговых Остап", "Заболотнева Мария", "Ковалева Ксения", "Надежкина Василиса", "Рябова Дарья", "Садыкова Алина", "Сопельцева Анна", "Талыпова Олеся", "Теплова Лукерья", "Трубаченко Наталья", "Устинов Иван", "Федоренко Анна", "Янченко Мария"]
    },
    {
      "external_id": "GRP-2026-CHOIR-02",
      "name": "Хоровое пение — 2 класс",
      "class_name": "2 класс · 8-летний срок обучения",
      "education_form": "ДПП",
      "instrument": "Хоровое пение",
      "teachers": ["Чебакова Елена Викторовна"],
      "students": ["Безвесельный Владимир", "Белякова Анастасия", "Ваганян Армен", "Дубицкая Наталья", "Климович Василиса", "Климович София", "Клюева Анастасия", "Никифорова Ариана", "Никольская София", "Пашнин Ярослав", "Перкова Анжелика", "Погребняк Милена", "Райдер Александр", "Рамазанова Ляйсан", "Сопельцева Дарья", "Тишкина Полина"]
    },
    {
      "external_id": "GRP-2026-CHOIR-03",
      "name": "Хоровое пение — 3 класс",
      "class_name": "3 класс · 8-летний срок обучения",
      "education_form": "ДПП",
      "instrument": "Хоровое пение",
      "teachers": ["Чебакова Елена Викторовна", "Савенкова Вероника Александровна", "Таганова Татьяна Евгеньевна"],
      "students": ["Балицкий Илья", "Галичина Кира", "Димова Вероника", "Конева Мария", "Масич Елисей", "Миклина Елизавета", "Мухина Анна", "Неустроева Вероника", "Недбайло Виктория", "Новокрещинова Василиса", "Серазеев Константин", "Трубаченко Михаил", "Шевякова Виктория"]
    },
    {
      "external_id": "GRP-2026-CHOIR-04",
      "name": "Хоровое пение — 4 класс",
      "class_name": "4 класс · 8-летний срок обучения",
      "education_form": "ДПП",
      "instrument": "Хоровое пение",
      "teachers": ["Чебакова Елена Викторовна", "Савенкова Вероника Александровна"],
      "students": ["Бухарина Алиса", "Григорьев Макар", "Еремеева Агата", "Захарова Александра", "Котлярова Алиса", "Михнюкевич Елизавета", "Мякишева София", "Рябова Мария"]
    },
    {
      "external_id": "GRP-2026-CHOIR-05",
      "name": "Хоровое пение — 5 класс",
      "class_name": "5 класс · 8-летний срок обучения",
      "education_form": "ДПП",
      "instrument": "Хоровое пение",
      "teachers": ["Чебакова Елена Викторовна"],
      "students": ["Гажало Алена", "Ильина Ульяна", "Киселева Вероника", "Максименко Анастасия", "Мензарарь Кристина", "Сейма Назар", "Тумакова Мария", "Четверикова Вероника", "Якушев Олег"]
    },
    {
      "external_id": "GRP-2026-CHOIR-07",
      "name": "Хоровое пение — 7 класс",
      "class_name": "7 класс · 8-летний срок обучения",
      "education_form": "ДПП",
      "instrument": "Хоровое пение",
      "teachers": ["Чебакова Елена Викторовна"],
      "students": ["Золотухина Милана", "Ильин Алексей", "Карпова Анна", "Курбатова Владислава", "Матвеева Алиса", "Мурашкина Ксения", "Нефедьева Екатерина", "Орлова Ксения", "Павлова Ксения", "Петрова Виктория", "Попов Алексей", "Раскина Анна", "Черткова Екатерина"]
    },
    {
      "external_id": "GRP-2026-CHOIR-08",
      "name": "Хоровое пение — 8 класс",
      "class_name": "8 класс · 8-летний срок обучения",
      "education_form": "ДПП",
      "instrument": "Хоровое пение",
      "teachers": ["Чебакова Елена Викторовна"],
      "students": ["Леонтьева Елизавета", "Летягина Александра", "Молодцева Анна"]
    },
    {
      "external_id": "GRP-2026-OEO-01",
      "name": "Общее эстетическое образование — 1 класс",
      "class_name": "1 класс · 5-летний срок обучения",
      "education_form": "ДОП",
      "instrument": "Общее эстетическое образование",
      "teachers": ["Иванищева Анна Михайловна", "Корнева Елена Станиславовна"],
      "students": ["Башкатов Данил", "Гончаров Владимир", "Есарева Екатерина", "Жаринов Богдан", "Климова Мария", "Красноперов Илья", "Куц Антонина", "Малявкин Дмитрий", "Минина Алиса", "Павлова София", "Сейма Лукьян", "Ударцева Дарья", "Шевякова Виолетта"]
    },
    {
      "external_id": "GRP-2026-OEO-03",
      "name": "Общее эстетическое образование — 3 класс",
      "class_name": "3 класс · 5-летний срок обучения",
      "education_form": "ДОП",
      "instrument": "Общее эстетическое образование",
      "teachers": ["Иванищева Анна Михайловна", "Корнева Елена Станиславовна"],
      "students": ["Давтян Тамара", "Константинова Ульяна", "Лежнин Алиса", "Морданенко Анастасия", "Никитенко Злата", "Пирогов Роман", "Сейма Фадей", "Тигиева Маргарита", "Торгашев Марк", "Уколкин Александр", "Шарипова Надежда", "Шляпкина Анастасия"]
    },
    {
      "external_id": "GRP-2026-OEO-04",
      "name": "Общее эстетическое образование — 4 класс",
      "class_name": "4 класс · 5-летний срок обучения",
      "education_form": "ДОП",
      "instrument": "Общее эстетическое образование",
      "teachers": ["Иванищева Анна Михайловна", "Корнева Елена Станиславовна"],
      "students": ["Бадритдинова Алина", "Зайкина Дарья", "Зайкина Елизавета", "Идрисова Алсу", "Ковинева Арина", "Лутикова Софья", "Нефедьев Кирилл", "Одинцова Милана", "Павлов Демьян", "Просвирина Ника", "Самойлова Екатерина", "Сейма Александр", "Семёнова Ева", "Степанова Наталья"]
    },
    {
      "external_id": "GRP-2026-OEO-05",
      "name": "Общее эстетическое образование — 5 класс",
      "class_name": "5 класс · 5-летний срок обучения",
      "education_form": "ДОП",
      "instrument": "Общее эстетическое образование",
      "teachers": ["Иванищева Анна Михайловна", "Корнева Елена Станиславовна"],
      "students": ["Габитова Милена", "Голубятникова Злата", "Грецова Евгения", "Джылыз Мелисса", "Колмакова Ольга", "Матьяш Георгий", "Прохоров Семён", "Стругова София", "Топычканова Ксения", "Трубаченко Александра"]
    }
  ]
  $seed$::jsonb) as seed(
    external_id text,
    name text,
    class_name text,
    education_form text,
    instrument text,
    teachers jsonb,
    students jsonb
  )
), target_state as (
  select id, payload
  from public.school_state
  order by updated_at desc
  limit 1
  for update
), prepared_groups as (
  select jsonb_build_object(
    'id', coalesce(
      (
        select existing->>'id'
        from jsonb_array_elements(coalesce(target.payload->'groups', '[]'::jsonb)) existing
        where existing->>'externalId' = seed.external_id
        limit 1
      ),
      gen_random_uuid()::text
    ),
    'externalId', seed.external_id,
    'name', seed.name,
    'className', seed.class_name,
    'educationForm', seed.education_form,
    'instrument', seed.instrument,
    'instruments', jsonb_build_array(seed.instrument),
    'studentIds', coalesce((
      select jsonb_agg(student->>'id' order by student->>'name')
      from jsonb_array_elements(coalesce(target.payload->'students', '[]'::jsonb)) student
      where regexp_replace(lower(translate(student->>'name', 'Ёё', 'Ее')), '\s+', '', 'g') in (
        select regexp_replace(lower(translate(value, 'Ёё', 'Ее')), '\s+', '', 'g')
        from jsonb_array_elements_text(seed.students)
      )
    ), '[]'::jsonb),
    'assignedEmployeeIds', coalesce((
      select jsonb_agg(employee->>'id' order by employee->>'name')
      from jsonb_array_elements(coalesce(target.payload->'employees', '[]'::jsonb)) employee
      where regexp_replace(lower(translate(employee->>'name', 'Ёё', 'Ее')), '\s+', '', 'g') in (
        select regexp_replace(lower(translate(value, 'Ёё', 'Ее')), '\s+', '', 'g')
        from jsonb_array_elements_text(seed.teachers)
      )
    ), '[]'::jsonb),
    'unresolvedStudentNames', coalesce((
      select jsonb_agg(value order by value)
      from jsonb_array_elements_text(seed.students) requested(value)
      where not exists (
        select 1
        from jsonb_array_elements(coalesce(target.payload->'students', '[]'::jsonb)) student
        where regexp_replace(lower(translate(student->>'name', 'Ёё', 'Ее')), '\s+', '', 'g')
          = regexp_replace(lower(translate(requested.value, 'Ёё', 'Ее')), '\s+', '', 'g')
      )
    ), '[]'::jsonb),
    'unresolvedTeacherNames', coalesce((
      select jsonb_agg(value order by value)
      from jsonb_array_elements_text(seed.teachers) requested(value)
      where not exists (
        select 1
        from jsonb_array_elements(coalesce(target.payload->'employees', '[]'::jsonb)) employee
        where regexp_replace(lower(translate(employee->>'name', 'Ёё', 'Ее')), '\s+', '', 'g')
          = regexp_replace(lower(translate(requested.value, 'Ёё', 'Ее')), '\s+', '', 'g')
      )
    ), '[]'::jsonb)
  ) as item
  from group_seed seed
  cross join target_state target
), new_group_array as (
  select coalesce(jsonb_agg(item order by item->>'externalId'), '[]'::jsonb) as items
  from prepared_groups
), retained_group_array as (
  select target.id,
    coalesce(jsonb_agg(existing) filter (where existing->>'externalId' not like 'GRP-2026-%'), '[]'::jsonb) as items
  from target_state target
  left join lateral jsonb_array_elements(coalesce(target.payload->'groups', '[]'::jsonb)) existing on true
  group by target.id
)
update public.school_state state
set payload = jsonb_set(
  state.payload,
  '{groups}',
  retained.items || imported.items,
  true
)
from retained_group_array retained
cross join new_group_array imported
where state.id = retained.id;

commit;

select
  item->>'name' as group_name,
  jsonb_array_length(coalesce(item->'studentIds', '[]'::jsonb)) as students_found,
  jsonb_array_length(coalesce(item->'unresolvedStudentNames', '[]'::jsonb)) as students_missing,
  jsonb_array_length(coalesce(item->'assignedEmployeeIds', '[]'::jsonb)) as teachers_found,
  jsonb_array_length(coalesce(item->'unresolvedTeacherNames', '[]'::jsonb)) as teachers_missing
from public.school_state state
cross join lateral jsonb_array_elements(coalesce(state.payload->'groups', '[]'::jsonb)) item
where state.id = (select id from public.school_state order by updated_at desc limit 1)
  and item->>'externalId' like 'GRP-2026-%'
order by item->>'externalId';
