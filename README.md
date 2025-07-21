# 🚀 Cloud-Synced Smart Attendance Tracker

A modern, user-friendly attendance tracking app built on the **Jamstack architecture**. Designed for students, this app makes it easy to build class schedules, track lecture attendance automatically, and use a **Smart Bunking Assistant** to manage attendance percentages effectively.

Built with **HTML**, **Tailwind CSS**, **Vanilla JS**, and powered by **Supabase** for backend services. Easily deployable on **Netlify**.

---

## ✨ Features

* **🔐 Secure Authentication**
  Sign up and log in via email/password. All user data is securely scoped to individual accounts using Supabase Auth.

* **🗓️ Manual Timetable Builder**
  Create your weekly schedule using an intuitive interface — no need to extract data from messy PDFs.

* **📅 Auto Lecture Logging**
  Automatically generates lecture records from your semester's start date, marking all as *Missed* by default.

* **⚖️ Weighted Attendance Calculation**
  Supports weighted lectures — e.g., Labs and core subjects like DSA/DA count as 2 lectures.

* **🧠 Smart Bunking Assistant**
  Recommends whether it's safe to bunk, how many lectures can be skipped, and what’s needed to recover.

* **🖱️ One-Click Attendance Saving**
  Save attendance for the whole day at once with a single button — no page reloads needed.

* **📆 Historical Editing**
  Use a date picker to view and modify attendance from any past day.

* **🧹 Flexible Reset Options**
  Reset just your attendance logs or your entire app data (including timetable).

---

## 🧰 Tech Stack

| Layer    | Technology                                           |
| -------- | ---------------------------------------------------- |
| Frontend | HTML5, Tailwind CSS, Vanilla JS (ES Modules)         |
| Backend  | [Supabase](https://supabase.com) (PostgreSQL + Auth) |
| Hosting  | [Netlify](https://www.netlify.com)                   |

---

## 🚀 Getting Started

### ✅ Prerequisites

* A [GitHub](https://github.com) account
* A [Supabase](https://supabase.com) account (Free Tier)
* A [Netlify](https://netlify.com) account (Free Tier)
* Git installed locally

---

### 🧾 Step 1: Clone This Repository

```bash
git clone https://github.com/KSB-1789/project_folder.git
cd project_folder
```

---

### 🛠️ Step 2: Set Up Supabase Backend

#### 1. Create a New Project

* Go to your [Supabase Dashboard](https://app.supabase.com/)
* Click **New project** and name it
* Save the database password securely

#### 2. Get API Credentials

* Go to **Settings → API**
* Save the following:

  * `Project URL`
  * `anon public` API Key

#### 3. Create Database Tables

In the **SQL Editor**, run:

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

CREATE POLICY "Users can manage their own profile" 
ON public.profiles FOR ALL 
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

CREATE POLICY "Users can manage their own attendance logs" 
ON public.attendance_log FOR ALL 
USING (auth.uid() = user_id);
```

---

### 🌐 Step 3: Deploy to Netlify

#### 1. Push to GitHub

```bash
git remote set-url origin https://github.com/your-username/your-new-repo.git
git push -u origin main
```

#### 2. Deploy Site

* Go to Netlify Dashboard → **Add new site → Import from GitHub**
* Select your repo and proceed

#### 3. Configure Build Command

In **Build Settings**, set:

```bash
echo "window.SUPABASE_URL='${SUPABASE_URL}'; window.SUPABASE_KEY='${SUPABASE_KEY}';" > js/netlify.js
```

This injects credentials **securely** during build time.

#### 4. Add Environment Variables

Go to your site’s dashboard → **Site Settings → Build & Deploy → Environment → Edit Variables**

Add:

| Key            | Value                     |
| -------------- | ------------------------- |
| `SUPABASE_URL` | Your Supabase Project URL |
| `SUPABASE_KEY` | Your anon public API Key  |

#### 5. Trigger Deploy

In the **Deploys** tab, click **Trigger deploy → Deploy site**
Your app should now be live!

---

## ✅ How to Use

1. Visit your deployed Netlify URL
2. Sign up for a new account
3. Follow the initial setup to define your weekly timetable
4. Your smart attendance dashboard is now ready!

---

## 📁 Project Structure

```
/
├── index.html              # Login / Signup
├── dashboard.html          # Main app interface
├── js/
│   ├── supabaseClient.js   # Supabase client init
│   ├── auth.js             # Login/signup logic
│   ├── app.js              # Main dashboard logic
│   └── netlify.js          # Injected by Netlify build
├── css/
│   └── style.css           # Tailwind + custom styles
└── README.md               # You’re reading it :)
```

---


