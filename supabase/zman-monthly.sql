-- זמן בכיף — מייל סיכום חודשי (ב-1 לכל חודש). רק מוסיף עמודה; לא נוגע בשום דבר קיים.
alter table zman_profiles add column if not exists monthly_email boolean not null default true;
alter table zman_profiles add column if not exists monthly_sent text; -- החודש האחרון שנשלח (YYYY-MM), כדי לא לשלוח פעמיים
