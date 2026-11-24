import { BellRing, Radio, ShieldAlert, Siren, Timer } from "lucide-react";
import type { DashboardSummary } from "@/types/dashboard";
import { formatCount, formatMinutes, formatRate, formatTrend } from "@/utils/dashboard-formatters";

export function DashboardKpis({ summary }: { readonly summary: DashboardSummary }) {
  return (
    <section className="kpi-strip" aria-label="Security operations key metrics">
      <Kpi label="Open incidents" value={formatCount(summary.incidents.open)} detail={`${formatCount(summary.incidents.investigating)} investigating`} trend={summary.incidents.openTrend} icon={ShieldAlert} adverseWhenUp />
      <Kpi label="Critical incidents" value={formatCount(summary.incidents.critical)} detail="Requires priority review" trend={summary.incidents.criticalTrend} icon={Siren} adverseWhenUp trendIsCount />
      <Kpi label="Events per second" value={formatRate(summary.events.eventsPerSecond)} detail={`${formatCount(summary.events.totalToday)} events in range`} trend={summary.events.epsTrend} icon={Radio} />
      <Kpi label="Alerts" value={formatCount(summary.alerts.totalToday)} detail={`${formatCount(summary.alerts.ruleAlerts)} rule · ${formatCount(summary.alerts.aiAlerts)} AI`} trend={summary.alerts.alertsTrend} icon={BellRing} />
      <Kpi label="Mean response time" value={formatMinutes(summary.responseTime.avgMinutes)} detail={`${formatMinutes(summary.responseTime.medianMinutes)} median`} trend={summary.responseTime.avgTrend} icon={Timer} adverseWhenUp />
    </section>
  );
}

function Kpi({ label, value, detail, trend, icon: Icon, adverseWhenUp = false, trendIsCount = false }: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly trend: number;
  readonly icon: typeof ShieldAlert;
  readonly adverseWhenUp?: boolean;
  readonly trendIsCount?: boolean;
}) {
  const tone = trend === 0 ? "neutral" : adverseWhenUp ? (trend > 0 ? "adverse" : "favorable") : "neutral";
  const trendText = trendIsCount
    ? trend === 0 ? "No change" : `${trend > 0 ? "+" : ""}${trend.toLocaleString("en")} vs prior`
    : formatTrend(trend);
  return (
    <div className="kpi-cell">
      <div className="kpi-label"><Icon size={15} aria-hidden="true" /><span>{label}</span></div>
      <strong className="kpi-value">{value}</strong>
      <div className="kpi-support"><span>{detail}</span><span className={`trend ${tone}`}>{trendText}</span></div>
    </div>
  );
}
