# Fitness system rebuild — Ayman's requirements, verbatim

Captured 2026-08-22. This is the SOURCE OF TRUTH for scope. The spec and plan
derive from it. If the spec and this file disagree, this file wins and the spec
is wrong. Do not paraphrase or "clean up" anything below.

---

so lets say i have 30 pull ups and 100 pushups in my plan right now, its
intersitial so can be done whenever thoruhgout the day, how would i even
structure/display that in the Now seciton, be clear and sepcifc, show me EXACTLY
how it would be strucutre in the most efficient way dont beat around ht ebush

[Lead's answer: collapsed one-line row in Now, both exercises in the title slot,
expands in place to RepGoalBars, bout-size prefill for two-tap logging.]

how about isntead of complicating it at first, lets just keep it generic so that
i basically displays the icon, domain title, and whatever the complete workout
for today is, it just lists the name/title of the workout. That takes us to a
structural change in the fitness section; right now in the fitness screen, there
is a seciton for my workouts ( a button which takes you to the my workouts
subscreen) where you can view workout plans, and create your own workout plan.
First, in this seciotion you shoud add the current workout plan (which is just 30
pull ups and 100 push ups a day), this workout plan is currently in effect but
not displayed in the list of workouts. So the Fitness seciton shoudl be
restructued such that at the top instead of the current 'My WOrkouts' section, it
shoudl display the current workout plan (so it shoudl say "Workout Plan: {name of
curernt workout plan in effect, if non selected it shoudl say none selected"},
then to the right of this in the same 'module' there shoudl be a My Workouts
button which leads to the same workouts screen, but inside this My Workouts
screen, change it so that at the top it shows the curerntly selected workout,
then below it shoudl be a list of the workouts created by the user, then to the
right of that should be a button to create a new workout, when creating a new
workout there should a name field, what the workout should be called, after the
name is entered it shoudl prompt whether the workout is a micro workout, or a
traditional routine; For a micro session they can add excsersies, everytime the
user adds an excersize there needs to be an excersize name, schedule (defaulted
to weekdays (options should be everyday, weekdays, weekends, M/W, T/TH, and
custom (so they can pick what days), goal (they can choose either a daily total
goal (which will be a speciifc number) or a frequency goal (basically means max
out or do however many possible this many times during the day), notes (optinoal
field for custom instructions/notes). Then for Traditional Routine: instead of
adding speciifc excersies like for micro, they can add 'sessions', first they
have to name the session, then add a schedule for it (options should be everyday,
weekdays, weekends, M/W, T/TH, and custom (so they can pick what days)), then
under each session they can add sepcific excersies, and for each excersies they
should add an excersise name and estimated duration (required fields), then the
following optional fields: weight, set value, and rep value. Once a workout is
created it is saved in the My Workouts list. When creating a workout (so inside
the workout creation panel, there should be a generic week long calendar view (so
a calendar view of a week from sudnay to saturday), and it should udpate in real
time with the excersies/sessions being added to that workout, this will hepl the
user visualize the workout when creating it. At any time, the user shoudl be able
to replace the current workout plan with an exisitng one inside the list. Also in
the My Workouts seciton, at the bottom (so beneath the list and the create
workout button) there should be the same but more detailed/expanded week long
calendar view with all the speciifc hours showcasing the exact schedule of the
workout for hte speciic days, by defualt it displays the routine of the current
workout, but if the user selects a new workout, like just presses it the calendar
should update temproraily displaying that specific workout's routine. Also to the
right of each workout in the list should be a delete and an edit button, and a
button to save the changes once they are making changes. Then inside the main
Fitness screen, add a module at the top (beneath Workouts Plan section at the top
most) called Daily Log: This shoudl basically list the exact workout
routine/excersies to complete along with any daily checks/logs that need to be
added (so remove the daily check's section and just cmobine it into this one),
also each task listed in teh Daily Log should have its correct funcitonanltiy
when you press on it, for micro workouts it shoudl ist all the specific excersies
indivially as indiudal logs, but for routines it shoudl list the entire session
as a whole not its speciifc excersies, so look through all the possible types of
daily log events, and then construct the necessary actions/features behind what
happens when you tap them because each one may be a little different in their
goal an waht informaiton they need and how to get it, but for any action on the
daily log, it should b efully fullillfed by whatever happens after you tap/click
on that log and do whatever action, and for some of them it wont even need to be
an all or nothing, if you tap on a log you could hav e aprgoress bar for certian
types of logs and once that fills thatts when the log goes away.

Now below the Daily Log module shoudl be another module called This week, and
this module shoudl basically combine the current This Week and Sessions module
into one full accurate calendar week displayed with all the workouts/routine
sessions applicable for each day, and this weekly log should include the real
dates and udpate in real time as the week progresses (this isnt a demo week
planner view like the other one inside the My Workouts tab), this one shoudl
include status of waht all workouts/excersies were completed and show the status
of competed, active for the day, and upcoming for that week. Then below this
module shoudl be the last module, called Cycle Progress checks, this shoudl have
current stats for specific stuff liek body weight, waist, excersies goals if
applicable, etc, then the abiltyt to long benchmark cycle progress. Go ahead and
fully implement all of these features with your entire team, use the plan mode to
start bcause tis alot, and store my prompt somehwere so you dont forget it, and
makes sure you include and work out every single sepcpic, and also include all
the logic gaps in my reaosning and build out a fully efficient, accurate, and
effective fitness screen/system
