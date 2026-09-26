import Link from "next/link";
import { requireAdmin } from "@/shared/session";
import { AdminPanel } from "@/components/admin-panel";
import { Navigation } from "@/components/navigation";

export default async function AdminPage() {
  const session = await requireAdmin();

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <Navigation
        user={{ name: session.user.name, email: session.user.email }}
        isAdmin={true}
      />

      <main className="flex-1 p-6 lg:p-8">
        <div className="mx-auto max-w-5xl">
          {/* Header */}
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">VYLO Admin Control Center</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                لوحة إدارة ومراقبة المنصة — للقراءة والإشراف · مدير النظام: {session.user.email}
              </p>
            </div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent"
            >
              العودة للرئيسية
            </Link>
          </div>

          <AdminPanel />
        </div>
      </main>
    </div>
  );
}
