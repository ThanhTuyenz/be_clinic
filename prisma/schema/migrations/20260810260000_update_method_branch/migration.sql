-- PostgreSQL truncates the original generated index name to 63 characters.
-- This migration must run after health_package_schedules has been created.
ALTER INDEX "health_package_schedules_health_package_id_room_id_exam_date_ke"
RENAME TO "health_package_schedules_health_package_id_room_id_exam_dat_key";
