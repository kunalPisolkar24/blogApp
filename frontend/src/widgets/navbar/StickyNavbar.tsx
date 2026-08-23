import {
  forwardRef,
  type ComponentPropsWithoutRef,
  useEffect,
  useState,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LogOut,
  Menu,
  PenSquare,
  ShieldCheck,
  User,
  Waypoints,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCurrentUser, useSessionActions } from "@/entities/session";
import { cn } from "@/shared/lib/cn";
import { useSessionStore } from "@/entities/session";

const authoringNavigation = {
  to: "/create-blog",
  label: "Create Blog",
  icon: PenSquare,
};

const reviewNavigation = {
  to: "/review",
  label: "Review",
  icon: ShieldCheck,
};

const accountNavigation = {
  to: "/profile",
  label: "Account",
  icon: User,
};

const stackedMenuActionClassName = cn(
  buttonVariants({ variant: "ghost", size: "lg" }),
  "w-full justify-start border-outline-variant/20 bg-surface-lowest px-4",
);

const stackedMenuDestructiveClassName = cn(
  buttonVariants({ variant: "destructive", size: "lg" }),
  "w-full justify-start border border-destructive/20 px-4 shadow-none",
);

const dropdownMenuActionClassName = cn(
  stackedMenuActionClassName,
  "cursor-pointer",
);

const dropdownMenuDestructiveClassName = cn(
  stackedMenuDestructiveClassName,
  "cursor-pointer text-destructive-foreground data-[highlighted]:bg-destructive data-[highlighted]:text-destructive-foreground",
);

const menuPanelSurfaceClassName =
  "relative overflow-hidden rounded-none border border-outline-variant/20 bg-surface-low text-foreground shadow-none ring-1 ring-outline-variant/20";

const menuPanelTintClassName =
  "pointer-events-none absolute inset-x-0 top-0 h-20 bg-[linear-gradient(180deg,rgba(31,26,72,0.88)_0%,rgba(31,26,72,0.28)_55%,transparent_100%)]";

const menuPanelDividerClassName =
  "h-px bg-gradient-to-r from-primary via-primary/45 to-transparent";

function NavbarBrand() {
  return (
    <Link
      to="/"
      className="group flex min-w-0 items-center gap-3"
      aria-label="Go to home page"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center bg-primary text-primary-foreground ring-1 ring-primary/35 transition-colors group-hover:bg-primary/90">
        <Waypoints className="h-5 w-5" />
      </span>
      <p className="font-mono text-[0.7rem] uppercase tracking-[0.28em] text-foreground">
        Topos
      </p>
    </Link>
  );
}

interface UserAvatarProps {
  avatarUrl?: string | null;
  label: string;
  initial: string;
  size?: "default" | "sm";
}

function UserAvatar({
  avatarUrl,
  label,
  initial,
  size = "default",
}: UserAvatarProps) {
  return (
    <Avatar
      size={size}
      className={cn(
        "bg-transparent after:border-transparent after:mix-blend-normal",
        size === "default" ? "size-10" : "size-9",
      )}
    >
      <AvatarImage src={avatarUrl || undefined} alt={label} />
      <AvatarFallback className="bg-primary-container text-primary-foreground font-mono text-[0.72rem] uppercase tracking-[0.12em]">
        {initial}
      </AvatarFallback>
    </Avatar>
  );
}

interface AccountTriggerButtonProps {
  avatarUrl?: string | null;
  label: string;
  initial: string;
  ariaLabel: string;
}

const AccountTriggerButton = forwardRef<
  HTMLButtonElement,
  AccountTriggerButtonProps & ComponentPropsWithoutRef<"button">
>(
  (
    {
      avatarUrl,
      label,
      initial,
      ariaLabel,
      className,
      ...props
    },
    ref,
  ) => {
    return (
      <Button
        ref={ref}
        type="button"
        variant="ghost"
        className={cn(
          "h-auto w-auto rounded-full border border-primary/45 bg-transparent p-0.5 hover:bg-transparent focus-visible:ring-primary-container",
          className,
        )}
        aria-label={ariaLabel}
        {...props}
      >
        <UserAvatar
          avatarUrl={avatarUrl}
          label={label}
          initial={initial}
        />
      </Button>
    );
  },
);

AccountTriggerButton.displayName = "AccountTriggerButton";

interface AccountMenuIdentityProps {
  avatarUrl?: string | null;
  displayName: string;
  email: string;
  initial: string;
}

function AccountMenuIdentity({
  avatarUrl,
  displayName,
  email,
  initial,
}: AccountMenuIdentityProps) {
  return (
    <div className="relative overflow-hidden border border-outline-variant/20 bg-surface-lowest px-4 py-3">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(31,26,72,0.22)_0%,transparent_100%)]" />
      <div className="relative flex items-center gap-3">
        <UserAvatar
          avatarUrl={avatarUrl}
          label={displayName}
          initial={initial}
          size="sm"
        />
        <div className="min-w-0 space-y-1">
          <p className="truncate text-sm font-medium text-foreground">
            {displayName}
          </p>
          <p className="truncate font-mono text-[0.68rem] tracking-[0.08em] text-muted-foreground">
            {email}
          </p>
        </div>
      </div>
    </div>
  );
}

export const StickyNavbar = () => {
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const status = useSessionStore((state) => state.status);
  const hasHydrated = useSessionStore((state) => state.hasHydrated);
  const { user } = useCurrentUser();
  const { logout } = useSessionActions();

  useEffect(() => {
    setIsAccountMenuOpen(false);
    setIsMobileMenuOpen(false);
  }, [pathname, status]);

  const handleLogout = async () => {
    setIsAccountMenuOpen(false);
    setIsMobileMenuOpen(false);
    await logout();
    navigate("/signin", { replace: true });
  };

  const handleAuthenticatedMobileToggle = () => {
    setIsMobileMenuOpen((prev) => !prev);
  };

  const isHydrating = !hasHydrated || status === "hydrating";
  const isAuthenticated = hasHydrated && status === "authenticated";
  const AuthoringIcon = authoringNavigation.icon;
  const ReviewIcon = reviewNavigation.icon;
  const displayName = user?.name || user?.username || "Workspace member";
  const accountIdentityName =
    user?.username || user?.name || "Workspace member";
  const userEmail = user?.email || "No email on file";
  const userInitial =
    user?.name?.charAt(0).toUpperCase() ||
    user?.username?.charAt(0).toUpperCase() ||
    user?.email?.charAt(0).toUpperCase() ||
    "U";

  return (
    <nav className="fixed inset-x-0 top-0 z-50 border-b border-outline-variant/20 bg-surface-low text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(77,68,227,0.06),transparent_24%,transparent_76%,rgba(77,68,227,0.06))]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent" />

      <div className="relative mx-auto flex h-[var(--app-navbar-height)] max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
        <div className="flex min-w-0 items-center gap-4">
          <NavbarBrand />
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {isHydrating ? (
            <div className="h-11 w-28 animate-pulse bg-surface-low ring-1 ring-outline-variant/20" />
          ) : isAuthenticated ? (
            <>
              <Link
                to={authoringNavigation.to}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "hidden h-11 px-4 md:inline-flex",
                )}
              >
                <AuthoringIcon className="h-4 w-4" />
                {authoringNavigation.label}
              </Link>

              <Link
                to={reviewNavigation.to}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "hidden h-11 px-4 md:inline-flex",
                )}
              >
                <ReviewIcon className="h-4 w-4" />
                {reviewNavigation.label}
              </Link>

              <DropdownMenu
                open={isAccountMenuOpen}
                onOpenChange={setIsAccountMenuOpen}
              >
                <DropdownMenuTrigger asChild>
                  <AccountTriggerButton
                    avatarUrl={user?.avatarUrl}
                    label={displayName}
                    initial={userInitial}
                    ariaLabel="Open account menu"
                    className="hidden md:inline-flex"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  sideOffset={10}
                  forceMount
                  className={cn(menuPanelSurfaceClassName, "w-[19rem] p-0")}
                >
                  <div className="relative p-3">
                    <div className={menuPanelTintClassName} />
                    <div className="relative space-y-3">
                      <AccountMenuIdentity
                        avatarUrl={user?.avatarUrl}
                        displayName={accountIdentityName}
                        email={userEmail}
                        initial={userInitial}
                      />
                      <div className={menuPanelDividerClassName} />
                      <div className="space-y-2">
                        <DropdownMenuItem
                          asChild
                          className={dropdownMenuActionClassName}
                        >
                          <Link to="/profile" className="flex w-full items-center">
                            <User className="mr-2 h-4 w-4" />
                            <span>Account</span>
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => void handleLogout()}
                          className={dropdownMenuDestructiveClassName}
                        >
                          <LogOut className="mr-2 h-4 w-4" />
                          <span>Log out</span>
                        </DropdownMenuItem>
                      </div>
                    </div>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              <AccountTriggerButton
                avatarUrl={user?.avatarUrl}
                label={displayName}
                initial={userInitial}
                ariaLabel={
                  isMobileMenuOpen
                    ? "Close mobile account menu"
                    : "Open mobile account menu"
                }
                aria-expanded={isMobileMenuOpen}
                onClick={handleAuthenticatedMobileToggle}
                className="md:hidden"
              />
            </>
          ) : (
            <>
              <Link
                to="/signin"
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                  "hidden h-11 px-4 md:inline-flex",
                )}
              >
                Sign In
              </Link>
              <Link
                to="/signup"
                className={cn(buttonVariants({ size: "sm" }), "h-11 px-4")}
              >
                Sign Up
              </Link>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-11 border border-outline-variant/20 bg-surface-lowest hover:bg-surface-low md:hidden"
                aria-expanded={isMobileMenuOpen}
                aria-label={
                  isMobileMenuOpen ? "Close navigation menu" : "Open navigation menu"
                }
                onClick={() => setIsMobileMenuOpen((prev) => !prev)}
              >
                {isMobileMenuOpen ? (
                  <X className="h-4 w-4" />
                ) : (
                  <Menu className="h-4 w-4" />
                )}
              </Button>
            </>
          )}
        </div>
      </div>

      {isMobileMenuOpen ? (
        <div className="relative border-t border-outline-variant/20 bg-surface-low md:hidden">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent" />
          <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
            <div className={cn(menuPanelSurfaceClassName, "p-3 ring-0")}>
              <div className={menuPanelTintClassName} />
              <div className="relative space-y-3">
                {isAuthenticated ? (
                  <>
                    <AccountMenuIdentity
                      avatarUrl={user?.avatarUrl}
                      displayName={accountIdentityName}
                      email={userEmail}
                      initial={userInitial}
                    />
                    <div className={menuPanelDividerClassName} />
                    <div className="space-y-2">
                      <Link
                        to={authoringNavigation.to}
                        onClick={() => setIsMobileMenuOpen(false)}
                        className={stackedMenuActionClassName}
                      >
                        <AuthoringIcon className="h-4 w-4" />
                        {authoringNavigation.label}
                      </Link>
                      <Link
                        to={reviewNavigation.to}
                        onClick={() => setIsMobileMenuOpen(false)}
                        className={stackedMenuActionClassName}
                      >
                        <ShieldCheck className="h-4 w-4" />
                        {reviewNavigation.label}
                      </Link>
                      <Link
                        to={accountNavigation.to}
                        onClick={() => setIsMobileMenuOpen(false)}
                        className={stackedMenuActionClassName}
                      >
                        <User className="h-4 w-4" />
                        {accountNavigation.label}
                      </Link>
                      <Button
                        type="button"
                        variant="destructive"
                        size="lg"
                        className={stackedMenuDestructiveClassName}
                        onClick={() => void handleLogout()}
                      >
                        <LogOut className="h-4 w-4" />
                        Log out
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <Link
                      to="/signin"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={stackedMenuActionClassName}
                    >
                      Sign In
                    </Link>
                    <Link
                      to="/signup"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={cn(
                        buttonVariants({ size: "lg" }),
                        "w-full justify-start px-4",
                      )}
                    >
                      Sign Up
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </nav>
  );
};
