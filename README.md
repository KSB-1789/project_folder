# 🚀 Cloud-Synced Smart Attendance Tracker

A modern, user-friendly attendance tracking app built on the Jamstack architecture. Designed for students, this app makes it easy to build class schedules, track lecture attendance automatically, and use a Smart Bunking Assistant to manage attendance percentages effectively.

Built with HTML, Tailwind CSS, and Vanilla JS, and powered by Supabase for all backend services. Easily deployable on Netlify.

-----

## ✨ Features

  * **🔐 Secure Authentication:** Sign up and log in via email/password. All user data is securely scoped to individual accounts using Supabase Auth and Row Level Security.
  * **🗓️ Intuitive Timetable Builder:** Create your weekly class schedule using a simple, manual interface — no need to extract data from messy PDFs.
  * **⚖️ Weighted Attendance:** Supports weighted lectures where Labs and core subjects like DSA/DA can count as 2 lectures per session, ensuring accurate calculations.
  * **🤖 Auto Lecture Logging:** Automatically generates daily lecture records from your semester's start date into the future, making the app ready to use instantly.
  * **🧠 Smart Bunking Assistant:** The assistant provides clear, actionable advice. It calculates how many *class sessions* (not just lectures) you can miss or need to attend to meet your percentage goals, with specific guidance for subjects with mixed-weight classes.
  * **🖱️ Efficient Attendance Marking:** Mark attendance for any day (past, present, or future) with simple button clicks. Save all changes for the day at once without needing a page reload.
  * **📅 Historical Editing:** Use a date picker to easily view and modify attendance records from any day in the past.
  * **🧹 Flexible Data Management:** Add extra working days (e.g., a Saturday that follows a Monday schedule) or reset your attendance logs without deleting your timetable.

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
      last_log_date DATE
    );

    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "Users can manage their own profile" ON public.profiles FOR ALL
    USING (auth.uid() = id);
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
