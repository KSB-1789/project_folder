# 🚀 Cloud-Synced Smart Attendance Tracker

A modern, user-friendly attendance tracking app built on the Jamstack architecture. Designed for students, this app makes it easy to build class schedules, track lecture attendance automatically, and use a Smart Bunking Assistant to manage attendance percentages effectively.

Built with HTML, Tailwind CSS, and Vanilla JS, and powered by Supabase for all backend services. Easily deployable on Netlify.

-----

## ✨ Features

### Core Features
* **🔐 Secure Authentication:** Sign up and log in via email/password. All user data is securely scoped to individual accounts using Supabase Auth and Row Level Security.
* **🗓️ Intuitive Timetable Builder:** Create your weekly class schedule using a simple, manual interface — no need to extract data from messy PDFs.
* **⚖️ Weighted Attendance:** Supports weighted lectures where Labs and core subjects like DSA/DA can count as 2 lectures per session, ensuring accurate calculations.
* **🤖 Auto Lecture Logging:** Automatically generates daily lecture records from your semester's start date into the future, making the app ready to use instantly.
* **🧠 Smart Bunking Assistant:** The assistant provides clear, actionable advice. It calculates how many *class sessions* (not just lectures) you can miss or need to attend to meet your percentage goals, with specific guidance for subjects with mixed-weight classes.
* **🖱️ Efficient Attendance Marking:** Mark attendance for any day (past, present, or future) with simple button clicks. Save all changes for the day at once without needing a page reload.
* **📅 Historical Editing:** Use a date picker to easily view and modify attendance records from any day in the past.
* **🧹 Flexible Data Management:** Add extra working days (e.g., a Saturday that follows a Monday schedule) or reset your attendance logs without deleting your timetable.

### 🆕 New Advanced Features
* **📅 Multiple Date-Ranged Timetables:** Create multiple timetables with different date ranges to handle temporary schedule changes (exam periods, workshops, etc.)
* **⚖️ Custom Subject Weights:** Set custom weights (1-5) for each subject instead of fixed rules, allowing for more precise attendance calculations
* **🔄 Automatic Timetable Switching:** The system automatically detects which timetable is active based on the current date
* **📋 Timetable Management:** Full CRUD operations for timetables - add, edit, delete, and view all your timetables
* **🎯 Per-Timetable Weights:** Different timetables can have different weights for the same subject
* **📊 Visual Timetable Status:** See which timetable is currently active with visual indicators and date ranges

-----

## 🧰 Tech Stack

| Layer      | Technology                               |
| :--------- | :--------------------------------------- |
| **Frontend** | HTML5, Tailwind CSS, Vanilla JS (ES Modules) |
| **Backend** | Supabase (PostgreSQL + Auth)             |
| **Hosting** | Netlify                                  |

-----

## 🚀 Getting Started

Follow these steps to deploy your own version of the Smart Attendance Tracker.

### ✅ Prerequisites

  * A **GitHub** account
  * A **Supabase** account (Free Tier is sufficient)
  * A **Netlify** account (Free Tier is sufficient)
  * **Git** installed on your local machine

### 🧾 Step 1: Fork and Clone the Repository

1.  **Fork the Repository:** Go to [https://github.com/KSB-1789/project\_folder](https://github.com/KSB-1789/project_folder) and click the "Fork" button to create a copy in your own GitHub account.
2.  **Clone Your Fork:** Open your terminal and run the following command, replacing `your-username` with your GitHub username:
    ```bash
    git clone https://github.com/your-username/project_folder.git
    cd project_folder
    ```

### 🛠️ Step 2: Set Up the Supabase Backend

1.  **Create a New Project:**

      * Go to your [Supabase Dashboard](https://supabase.com/dashboard).
      * Click "New project," give it a name, and generate a secure database password.
      * Save your database password somewhere safe.

2.  **Get Your API Credentials:**

      * In your new project, go to **Settings** → **API**.
      * Find and copy the **Project URL** and the **anon (public) API Key**. You will need these later.

3.  **Create the Database Tables:**

      * Go to the **SQL Editor** in your Supabase project.
      * Click "+ New query" and run the following two SQL snippets one by one.

    **A. `profiles` Table**

    ```sql
    CREATE TABLE public.profiles (
      id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      start_date DATE NOT NULL,
      attendance_threshold INTEGER NOT NULL,
      timetable_json JSONB NOT NULL,
      unique_subjects TEXT[] NOT NULL,
      last_log_date DATE,
      timetables JSONB DEFAULT '[]'::jsonb
    );

    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "Users can manage their own profile" ON public.profiles FOR ALL
    USING (auth.uid() = id);

    -- Add constraint and index for timetables
    ALTER TABLE public.profiles 
    ADD CONSTRAINT timetables_must_be_array 
    CHECK (jsonb_typeof(timetables) = 'array');

    CREATE INDEX idx_profiles_timetables ON public.profiles USING GIN (timetables);
    ```

    **B. `attendance_log` Table**

    ```sql
    CREATE TABLE public.attendance_log (
      id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      subject_name TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL,
      UNIQUE(user_id, date, subject_name, category)
    );

    ALTER TABLE public.attendance_log ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "Users can manage their own attendance logs" ON public.attendance_log FOR ALL
    USING (auth.uid() = user_id);
    ```

4.  **Migrate Existing Data (if upgrading from older version):**

    If you're upgrading from an older version, run this migration script to enable the new multiple timetables feature:

    ```sql
    -- Add the new timetables column
    ALTER TABLE public.profiles 
    ADD COLUMN timetables JSONB DEFAULT '[]'::jsonb;

    -- Create migration function
    CREATE OR REPLACE FUNCTION migrate_existing_timetables()
    RETURNS void AS $$
    DECLARE
        profile_record RECORD;
        timetable_obj JSONB;
        subject_weights JSONB := '{}'::jsonb;
        subject_name TEXT;
        category TEXT;
        full_subject_name TEXT;
    BEGIN
        FOR profile_record IN SELECT * FROM public.profiles WHERE timetable_json IS NOT NULL LOOP
            subject_weights := '{}'::jsonb;
            
            FOR subject_name, category IN 
                SELECT DISTINCT 
                    array_to_string(string_to_array(subject_string, ' '), ' ', 1, array_length(string_to_string(subject_string, ' '), 1) - 1) as subject_name,
                    (string_to_array(subject_string, ' '))[array_length(string_to_string(subject_string, ' '), 1)] as category
                FROM (
                    SELECT unnest(timetable_json->day) as subject_string
                    FROM public.profiles, 
                         jsonb_object_keys(timetable_json) as day
                    WHERE id = profile_record.id
                ) subjects
            LOOP
                full_subject_name := subject_name || ' ' || category;
                
                IF category = 'Lab' THEN
                    subject_weights := jsonb_set(subject_weights, ARRAY[full_subject_name], '2');
                ELSIF subject_name = 'DSA' OR subject_name = 'DA' THEN
                    subject_weights := jsonb_set(subject_weights, ARRAY[full_subject_name], '2');
                ELSE
                    subject_weights := jsonb_set(subject_weights, ARRAY[full_subject_name], '1');
                END IF;
            END LOOP;
            
            timetable_obj := jsonb_build_object(
                'id', gen_random_uuid(),
                'name', 'Regular Semester',
                'startDate', profile_record.start_date,
                'endDate', (profile_record.start_date + interval '6 months')::date,
                'schedule', profile_record.timetable_json,
                'subjectWeights', subject_weights
            );
            
            UPDATE public.profiles 
            SET timetables = jsonb_build_array(timetable_obj)
            WHERE id = profile_record.id;
        END LOOP;
    END;
    $$ LANGUAGE plpgsql;

    -- Execute migration
    SELECT migrate_existing_timetables();

    -- Clean up
    DROP FUNCTION migrate_existing_timetables();
    ```

### 🌐 Step 3: Deploy to Netlify

1.  **Import Your Project:**

      * Go to your [Netlify Dashboard](https://app.netlify.com/).
      * Click "Add new site" → "Import an existing project."
      * Choose "Deploy with GitHub" and authorize access.
      * Select the repository you forked earlier.

2.  **Configure the Build Command:**

      * In the deploy settings, find the **Build command** field.
      * Enter the following command. This securely injects your Supabase credentials into a file that the app can use, without exposing them in your public repository.
        ```bash
        echo "window.SUPABASE_URL='${SUPABASE_URL}'; window.SUPABASE_KEY='${SUPABASE_KEY}';" > js/netlify.js
        ```
      * Leave the **Publish directory** field empty or set to the project root.

3.  **Add Environment Variables:**

      * After the site is created, go to its dashboard and navigate to **Site settings** → **Build & deploy** → **Environment**.
      * Click "Edit variables" and add the following two variables using the credentials you copied from Supabase:

| Key             | Value                    |
| :-------------- | :----------------------- |
| `SUPABASE_URL`  | Your Supabase Project URL  |
| `SUPABASE_KEY`  | Your `anon` public API Key |

4.  **Trigger Deploy:**
      * Go to the "Deploys" tab for your site.
      * Click "Trigger deploy" → "Deploy site."
      * Your app will build and go live in a minute or two\!

-----

## 🆕 How the New Features Work

### Multiple Date-Ranged Timetables

The system now supports multiple timetables with different date ranges. Each timetable contains:

```json
{
  "id": "unique-uuid",
  "name": "Regular Semester",
  "startDate": "2024-01-15",
  "endDate": "2024-07-15",
  "schedule": {
    "Monday": ["DSA Theory", "Math Lab"],
    "Tuesday": ["Physics Theory"],
    // ... other days
  },
  "subjectWeights": {
    "DSA Theory": 2,
    "Math Lab": 2,
    "Physics Theory": 1
  }
}
```

**How it works:**
- The system automatically detects which timetable is active based on the current date
- Attendance calculations use the schedule and weights from the active timetable
- You can create different timetables for exam periods, workshops, or other special schedules
- All existing attendance data is preserved when switching between timetables

### Custom Subject Weights

Instead of fixed rules (Lab=2, DSA/DA=2, others=1), you can now set custom weights (1-5) for each subject:

- **Weight 1:** Standard lecture (counts as 1 attendance)
- **Weight 2:** Important subject (counts as 2 attendances)
- **Weight 3-5:** Special importance (counts as 3-5 attendances)

This allows for more precise attendance calculations based on your institution's specific requirements.

### Timetable Management

Access the new timetable management features in the **Settings** section:

1. **View All Timetables:** See a list of all your timetables with their date ranges and active status
2. **Add New Timetable:** Create a new timetable with custom date range and subject weights
3. **Edit Timetable:** Modify existing timetables (name, dates, schedule, weights)
4. **Delete Timetable:** Remove timetables you no longer need

-----

## 📁 Project Structure

```
/
├── css/
│   └── style.css           # Styling (Tailwind CSS)
├── js/
│   ├── app.js              # Core dashboard logic
│   ├── auth.js             # Login/signup logic
│   ├── netlify.js          # Injected by Netlify build
│   └── supabaseClient.js   # Initializes the Supabase client
├── dashboard.html          # Main application interface
├── index.html              # Login / Signup page
├── LICENSE                 # Apache-2.0 License
└── README.md               # You’re reading it :)
```

-----

## 📄 License

This project is licensed under the **Apache-2.0 License**.
