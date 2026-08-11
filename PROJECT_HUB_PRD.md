# Project Hub - Product Requirements Document

## 1. Product summary

Project Hub is a web-based project and task management system for teams managing multiple projects, owners, deadlines, follow-ups, issues, and delivery risk. It is designed as a lightweight operational alternative to Jira, Asana, or Monday.com.

The application presents a portfolio dashboard, detailed task operations, a daily follow-up queue, issue tracking, and an auditable notification workflow.

## 2. Users and goals

| User | Primary goal |
| --- | --- |
| Platform administrator | Maintain projects, tasks, workflow data, and automation settings. |
| Project manager | Monitor progress, assign tasks, track blockers, follow up, and escalate overdue work. |
| Team member | Understand assigned work, deadlines, dependencies, expected effort, and follow-up actions. |
| Stakeholder | See project health, critical issues, deadline risk, and delivery progress. |

## 3. Core product behavior

### 3.1 Dashboard

The dashboard is the portfolio command center. It shows:

- Total and active projects.
- Tasks due today and overdue tasks.
- Average project progress.
- Project progress by project manager.
- Counts for every task status.
- Upcoming deadlines.
- Daily follow-up queue counts.
- Open issues and their owners.

### 3.2 Project records

Each project has an ID, name, client, project manager, start date, end date, status, priority, and progress percentage.

Projects group all related tasks and issues.

### 3.3 Task tracker

The task tracker is the primary operating screen. Each task stores:

| Field | Purpose |
| --- | --- |
| Task ID | Unique task reference, such as `TSK-010`. |
| Project and module | Identifies the workstream. |
| Title and description | Defines the required work and expected outcome. |
| Assigned by / assigned to | Records accountability and ownership. |
| Priority | Critical, High, Medium, or Low. |
| Status | Workflow state defined below. |
| Start and due date | Establish the planned delivery window. |
| Estimated and actual hours | Supports effort tracking and workload analysis. |
| Dependencies | Lists tasks that must complete first. |
| Progress | Completion percentage from 0 to 100. |
| Next follow-up | Date on which the task should appear in the follow-up queue. |
| Remarks | Holds operational notes, blockers, or handover context. |

### 3.4 Task status lifecycle

| Status | Meaning |
| --- | --- |
| Not Started | Work is known but has not begun. |
| Assigned | An owner has been allocated. |
| In Progress | Active work is underway. |
| Under Review | Work is awaiting QA, manager, or stakeholder approval. |
| On Hold | Work is temporarily paused without being a blocker. |
| Blocked | Work cannot continue until an external condition is resolved. |
| Completed | Work is finished; it is excluded from open-task and overdue calculations. |

Project managers can update a task's status, progress, actual hours, and next follow-up date from the task detail panel.

## 4. Daily follow-up logic

Every open task is classified automatically using the current date and its task fields:

| Queue | Rule |
| --- | --- |
| Due Today | `due_date` equals today. |
| Overdue | `due_date` is before today and status is not Completed. |
| Follow-up Today | `next_follow_up` equals today and status is not Completed. |
| Waiting for Review | Status is Under Review. |

One task may appear in more than one queue. For example, a task can be overdue and also scheduled for follow-up today.

## 5. Issue tracker

Issues capture delivery risks and blockers separately from tasks. Each issue contains:

- Issue ID and title.
- Project and optional related task.
- Description.
- Raised by and owner.
- Priority: Critical, High, Medium, or Low.
- Status: Open, In Progress, Blocked, or Resolved.
- Resolution date.

Issues are surfaced on the dashboard so managers can identify ownerless or critical delivery risk early.

## 6. Data and technical architecture

```text
React web application
        |
        | /api requests
        v
Express API server
        |
        +-- Neon Postgres: projects, tasks, dependencies, issues, activity
```

### Main database tables

- `projects`: project master data.
- `tasks`: complete task records and workflow fields.
- `task_dependencies`: many-to-many links between dependent tasks.
- `issues`: issue and risk records.
- `activity`: recent dashboard activity.

## 7. Running the application

### Development

```powershell
npm run dev
```

Open `http://localhost:5173`.

### Production-like local run

```powershell
npm run build
npm start
```

Open `http://localhost:3001`.

### Neon setup

1. Create a Neon Postgres database.
2. Run `db/schema.sql` in the Neon SQL editor.
3. Copy `.env.example` to `.env`.
4. Add the Neon `DATABASE_URL`.
5. Restart the application.

Without `DATABASE_URL`, the application runs with in-memory demo data. Demo changes are lost when the server restarts.

## 9. Simplified product scope

Implemented operational modules are Dashboard, Projects, Task Tracker, Daily Follow-up, and Issue Tracker.

There are no standalone Timeline, Team Workload, Dependencies, Meetings, Reminders, or Reports modules. Start and due dates provide the necessary scheduling information. Dependencies are captured only while creating a task through two independent choices:

- **Depends on other task(s):** reveals prerequisite task IDs.
- **Requires input or approval from a person:** reveals the person, dependency type, required action, needed-by date, status, and remarks.
