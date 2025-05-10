import React, { useState, useEffect } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { User, LogOut, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';

export const StickyNavbar: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [userInitial, setUserInitial] = useState("U");
  const [userAvatarUrl, setUserAvatarUrl] = useState<string | undefined>(undefined);
  const navigate = useNavigate();
  const [isLoggedIn, setIsLoggedIn] = useState(!!localStorage.getItem('jwt'));

  const handleLogout = () => {
    localStorage.removeItem('jwt');
    setIsLoggedIn(false);
    setUserInitial("U");
    setUserAvatarUrl(undefined);
    navigate('/signin');
  };

  useEffect(() => {
    const fetchUserData = async () => {
      const jwt = localStorage.getItem('jwt');
      if (jwt) {
        setIsLoggedIn(true);
        try {
          const decodedToken = JSON.parse(atob(jwt.split('.')[1]));
          const userId = decodedToken.id;

          const response = await axios.get(`${import.meta.env.VITE_BACKEND_URL}/api/users/${userId}`, {
            headers: { Authorization: `Bearer ${jwt}` }
          });
          const username = response.data.username;
          
          const initial = username ? username.charAt(0).toUpperCase() : "U";
          setUserInitial(initial);

          setUserAvatarUrl(`https://i.pravatar.cc?u=${encodeURIComponent(username || `user-${userId}`)}&background=random&color=fff&size=40&font-size=0.5&rounded=true`);

        } catch (error) {
          console.error("Error fetching user data:", error);
          if (axios.isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 403)) {
            handleLogout(); 
          } else {
            setUserInitial("U");
            setUserAvatarUrl(undefined);
          }
        }
      } else {
        setIsLoggedIn(false);
        setUserInitial("U");
        setUserAvatarUrl(undefined);
      }
    };

    fetchUserData();
  }, [navigate]); 


   useEffect(() => {
    const syncLogout = (event: StorageEvent) => {
      if (event.key === 'jwt' && !event.newValue) {
        setIsLoggedIn(false);
        setUserInitial("U");
        setUserAvatarUrl(undefined);
        if (window.location.pathname !== '/signin' && window.location.pathname !== '/signup') {
          navigate('/signin');
        }
      } else if (event.key === 'jwt' && event.newValue && !localStorage.getItem('jwt')) {
      }
    };

    window.addEventListener('storage', syncLogout);
    return () => {
      window.removeEventListener('storage', syncLogout);
    };
  }, [navigate]);


  const handleHomeClick = () => {
    navigate('/');
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-zinc-950/95 shadow">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-[50px] items-center">
          <div className="flex-shrink-0 flex items-center">
            <button onClick={handleHomeClick} className="text-xl font-bold text-foreground">
              <span className="hidden sm:inline">blogApp</span>
              <span className="sm:hidden">bA</span>
            </button>
          </div>

          {isLoggedIn ? (
            <div className="flex items-center">
              <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="h-8 w-8 rounded-full">
                    <Avatar className="h-8 w-8">
                      {userAvatarUrl && <AvatarImage src={userAvatarUrl} alt={userInitial} />}
                      <AvatarFallback>{userInitial}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                  <DropdownMenuItem>
                    <User className="mr-2 h-4 w-4" />
                    <span>View Profile</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/create-blog" className="flex items-center w-full">
                      <Plus className="mr-2 h-4 w-4" />
                      <span>Create a Blog</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={handleLogout} 
                    className='text-red-500 data-[highlighted]:text-red-500 data-[highlighted]:bg-red-500/10'
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <div className="flex items-center space-x-2">
              <Button variant="ghost" asChild>
                <Link to="/signin">Sign In</Link>
              </Button>
              <Button asChild>
                <Link to="/signup">Sign Up</Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};