import { Routes, Route, Navigate, useParams } from "react-router";
import Home from "./sites/marketing/Home";
import PricingPage from "./sites/marketing/PricingPage";
import ProductPage, { PRODUCTS } from "./sites/marketing/ProductPage";
import { LoginPage, FreeTrialPage, ScheduleDemoPage, ComingSoonPage } from "./sites/marketing/AuthPages";
import AppShell from "./sites/app/AppShell";
import Dashboard from "./sites/app/pages/Dashboard";
import CalendarPage from "./sites/app/pages/CalendarPage";
import TasksPage from "./sites/app/pages/TasksPage";
import CasesPage from "./sites/app/pages/CasesPage";
import CaseDetail from "./sites/app/pages/CaseDetail";
import ContactsPage from "./sites/app/pages/ContactsPage";
import LeadsPage from "./sites/app/pages/LeadsPage";
import TimePage from "./sites/app/pages/TimePage";
import InvoicesPage from "./sites/app/pages/InvoicesPage";
import PaymentsPage from "./sites/app/pages/PaymentsPage";
import AccountingPage from "./sites/app/pages/AccountingPage";
import DocumentsPage from "./sites/app/pages/DocumentsPage";
import CommunicationsPage from "./sites/app/pages/CommunicationsPage";
import ReportsPage from "./sites/app/pages/ReportsPage";
import SettingsPage from "./sites/app/pages/SettingsPage";
import MockGatewayPage from "./sites/app/pages/MockGatewayPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/products/:slug" element={<ProductRoute />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/free-trial" element={<FreeTrialPage />} />
      <Route path="/schedule-demo" element={<ScheduleDemoPage />} />
      <Route path="/coming-soon" element={<ComingSoonPage />} />
      {/* V2 slice 1, ticket 07: the Demo Version's simulated gateway checkout.
          Mock mode only (the page itself redirects http mode). */}
      <Route path="/pay/:id" element={<MockGatewayPage />} />

      <Route path="/app" element={<AppShell />}>
        <Route index element={<Dashboard />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="cases" element={<CasesPage />} />
        <Route path="cases/:id" element={<CaseDetail />} />
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="leads" element={<LeadsPage />} />
        <Route path="billing/time" element={<TimePage />} />
        <Route path="billing/expenses" element={<TimePage tab="expenses" />} />
        <Route path="billing/invoices" element={<InvoicesPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="accounting" element={<AccountingPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="communications" element={<CommunicationsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function ProductRoute() {
  const { slug } = useParams();
  const spec = PRODUCTS.find((p) => p.slug === slug) ?? PRODUCTS[0];
  if (!spec) return <ComingSoonPage />;
  return <ProductPage spec={spec} />;
}
