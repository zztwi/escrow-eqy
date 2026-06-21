const statuses = [
  { label: "pending", color: "var(--gray)", bg: "rgba(91,100,120,.12)", width: 6 },
  { label: "deposit received", color: "var(--blue)", bg: "rgba(108,142,239,.12)", width: 28 },
  { label: "funds confirmed", color: "var(--green-soft)", bg: "rgba(74,222,154,.12)", width: 50 },
  { label: "in delivery", color: "var(--green)", bg: "rgba(52,211,153,.12)", width: 72 },
  { label: "released", color: "var(--brass)", bg: "rgba(201,164,92,.16)", width: 100 },
];

const badge = document.getElementById("badge");
const fill = document.getElementById("trackFill");
const labels = document.querySelectorAll("#trackLabels span");
const seal = document.getElementById("ticketSeal");
let step = 0;

const renderStep = (index) => {
  const status = statuses[index];
  badge.textContent = status.label;
  badge.style.color = status.color;
  badge.style.background = status.bg;
  fill.style.width = `${status.width}%`;
  labels.forEach((label, labelIndex) => {
    label.classList.toggle("active", labelIndex <= index);
  });
  seal.classList.toggle("show", index === statuses.length - 1);
};

renderStep(0);
setInterval(() => {
  step = (step + 1) % statuses.length;
  renderStep(step);
}, 2200);

document.querySelectorAll(".term-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".term-tab").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".term-pane").forEach((pane) => pane.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`.term-pane[data-pane="${tab.dataset.tab}"]`)?.classList.add("active");
  });
});

const revealItems = document.querySelectorAll(".tl-item, .feat, .trust-item");
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("in");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.15 }
);

revealItems.forEach((item) => observer.observe(item));
