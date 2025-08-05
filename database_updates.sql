-- Database Updates for Special Timetable Support
-- Run these commands in your Supabase SQL Editor
-- This script works with your existing schema that already has profiles and attendance_log tables

-- 1. Add attendance_paused column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS attendance_paused BOOLEAN DEFAULT FALSE;

-- 2. Add type and is_active columns to timetables (if stored as JSONB in profiles)
-- Note: Since timetables are stored as JSONB in the profiles table,
-- we don't need to modify the table structure. The new fields will be added
-- automatically when new timetables are created.

-- 3. Create a function to help with timetable management
CREATE OR REPLACE FUNCTION get_active_timetable(user_id UUID, check_date DATE)
RETURNS JSONB AS $$
DECLARE
    user_profile JSONB;
    timetables JSONB;
    active_timetable JSONB;
    timetable JSONB;
BEGIN
    -- Get user profile
    SELECT profiles.* INTO user_profile 
    FROM public.profiles 
    WHERE id = user_id;
    
    IF user_profile IS NULL THEN
        RETURN NULL;
    END IF;
    
    timetables := user_profile->'timetables';
    
    -- First check for active special timetables
    FOR timetable IN SELECT * FROM jsonb_array_elements(timetables)
    LOOP
        IF (timetable->>'type' = 'special' OR timetable->>'type' IS NULL) 
           AND (timetable->>'isActive' = 'true' OR timetable->>'isActive' IS NULL)
           AND check_date >= (timetable->>'startDate')::DATE 
           AND check_date <= (timetable->>'endDate')::DATE THEN
            RETURN timetable;
        END IF;
    END LOOP;
    
    -- Then check for normal timetables
    FOR timetable IN SELECT * FROM jsonb_array_elements(timetables)
    LOOP
        IF (timetable->>'type' = 'normal' OR timetable->>'type' IS NULL)
           AND check_date >= (timetable->>'startDate')::DATE 
           AND check_date <= (timetable->>'endDate')::DATE THEN
            RETURN timetable;
        END IF;
    END LOOP;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 4. Create a view for better timetable analysis
CREATE OR REPLACE VIEW timetable_analysis AS
SELECT 
    p.id as user_id,
    p.attendance_paused,
    tt->>'id' as timetable_id,
    tt->>'name' as timetable_name,
    tt->>'type' as timetable_type,
    tt->>'isActive' as is_active,
    tt->>'startDate' as start_date,
    tt->>'endDate' as end_date,
    tt->>'schedule' as schedule,
    tt->>'subjectWeights' as subject_weights
FROM public.profiles p,
     jsonb_array_elements(p.timetables) as tt
WHERE p.timetables IS NOT NULL;

-- 5. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_attendance_log_user_date 
ON public.attendance_log(user_id, date);

CREATE INDEX IF NOT EXISTS idx_attendance_log_subject_category 
ON public.attendance_log(subject_name, category);

-- 6. Create a function to calculate attendance with special timetable support
CREATE OR REPLACE FUNCTION calculate_attendance_percentage(
    user_id UUID, 
    subject_name TEXT, 
    category TEXT, 
    from_date DATE DEFAULT NULL,
    to_date DATE DEFAULT NULL
)
RETURNS TABLE(
    attended_count INTEGER,
    held_count INTEGER,
    percentage NUMERIC(5,2)
) AS $$
DECLARE
    user_profile JSONB;
    attendance_paused BOOLEAN;
    log_record RECORD;
    weight NUMERIC;
    attended_weight NUMERIC := 0;
    held_weight NUMERIC := 0;
BEGIN
    -- Get user profile
    SELECT profiles.* INTO user_profile 
    FROM public.profiles 
    WHERE id = user_id;
    
    attendance_paused := COALESCE(user_profile->>'attendance_paused', 'false')::BOOLEAN;
    
    -- Calculate attendance
    FOR log_record IN 
        SELECT al.*, al.date as log_date
        FROM public.attendance_log al
        WHERE al.user_id = calculate_attendance_percentage.user_id
          AND al.subject_name = calculate_attendance_percentage.subject_name
          AND al.category = calculate_attendance_percentage.category
          AND (from_date IS NULL OR al.date >= from_date)
          AND (to_date IS NULL OR al.date <= to_date)
        ORDER BY al.date
    LOOP
        -- Get weight for this specific date
        SELECT COALESCE(
            (get_active_timetable(user_id, log_record.log_date)->'subjectWeights'->>(subject_name || ' ' || category))::NUMERIC,
            1
        ) INTO weight;
        
        -- Skip if attendance is paused and this is not a special timetable day
        IF attendance_paused THEN
            IF get_active_timetable(user_id, log_record.log_date)->>'type' != 'special' THEN
                CONTINUE;
            END IF;
        END IF;
        
        -- Add to counts
        IF log_record.status IN ('Attended', 'Missed') THEN
            held_weight := held_weight + weight;
        END IF;
        
        IF log_record.status = 'Attended' THEN
            attended_weight := attended_weight + weight;
        END IF;
    END LOOP;
    
    RETURN QUERY SELECT 
        attended_weight::INTEGER,
        held_weight::INTEGER,
        CASE 
            WHEN held_weight > 0 THEN (attended_weight / held_weight * 100)
            ELSE 0 
        END;
END;
$$ LANGUAGE plpgsql;

-- 7. Add comments for documentation
COMMENT ON FUNCTION get_active_timetable(UUID, DATE) IS 'Returns the active timetable for a user on a specific date, prioritizing special timetables over normal ones';
COMMENT ON FUNCTION calculate_attendance_percentage(UUID, TEXT, TEXT, DATE, DATE) IS 'Calculates attendance percentage for a subject considering special timetables and pause status';
COMMENT ON VIEW timetable_analysis IS 'Provides a structured view of all timetables for analysis purposes';

-- 8. Update existing timetables to have type field (for backward compatibility)
UPDATE public.profiles 
SET timetables = (
    SELECT jsonb_agg(
        CASE 
            WHEN tt->>'type' IS NULL THEN jsonb_set(tt, '{type}', '"normal"')
            ELSE tt
        END
    )
    FROM jsonb_array_elements(timetables) as tt
)
WHERE timetables IS NOT NULL; 