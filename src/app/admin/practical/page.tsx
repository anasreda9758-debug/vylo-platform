import { requireAdmin } from "@/shared/session";
import { Navigation } from "@/components/navigation";
import { PracticalAuthoringAdmin } from "@/components/practical-authoring-admin";
import Link from "next/link";

export default async function PracticalAdminPage() {
  const session = await requireAdmin();

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <Navigation
        user={{ name: session.user.name, email: session.user.email }}
        isAdmin={true}
      />
      <main className="flex-1 p-6 lg:p-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">تأليف الامتحانات العملية</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                إعداد أسئلة تحديد البنية بعين السهم — يُعرض للطلاب فقط ما تم اعتماده
              </p>
            </div>
            <Link
              href="/admin"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent"
            >
              عودة للوحة الإدارة
            </Link>
          </div>
          <PracticalAuthoringAdmin />
        </div>
      </main>
    </div>
  );
}