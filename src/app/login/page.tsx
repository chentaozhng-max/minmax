import { redirectIfLoggedIn } from "@/lib/page-auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  await redirectIfLoggedIn();
  return <LoginForm />;
}
