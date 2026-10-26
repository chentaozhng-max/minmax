import { ExperimentCardSkeleton } from "@/components/experiment-card";

export default function Loading() {
  return (
    <div className="shell px-4 pt-20">
      <div className="skeleton mb-4 h-11 rounded-pill" />
      <div className="space-y-2">
        <ExperimentCardSkeleton />
        <ExperimentCardSkeleton />
        <ExperimentCardSkeleton />
      </div>
    </div>
  );
}
