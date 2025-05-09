import type React from "react"
import { useState } from "react"
import { z } from "zod"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { useNavigate } from "react-router-dom"
import axios from "axios"
import { signinSchema as baseSigninSchema, type SigninSchemaType } from "@kunalpisolkar24/blogapp-common"

const extendedSigninSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
})

export const Signin = () => {
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()
  const navigate = useNavigate()

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))

    if (errors[name]) {
      setErrors((prev) => {
        const newErrors = { ...prev }
        delete newErrors[name]
        return newErrors
      })
    }
  }

  const validateForm = () => {
    try {
      extendedSigninSchema.parse(formData)
      setErrors({})
      return true
    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors: Record<string, string> = {}
        error.errors.forEach((err) => {
          if (err.path[0]) {
            newErrors[err.path[0] as string] = err.message
          }
        })
        setErrors(newErrors)
      }
      return false
    }
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (!validateForm()) return

    setIsLoading(true)

    try {
      const parsedInput = baseSigninSchema.safeParse(formData)

      if (!parsedInput.success) {
        toast({
          variant: "destructive",
          title: "Error",
          description: parsedInput.error.errors[0].message,
        })
        setIsLoading(false)
        return
      }

      const validatedInput: SigninSchemaType = parsedInput.data

      const response = await axios.post(`${import.meta.env.VITE_BACKEND_URL}/api/signin`, validatedInput)

      localStorage.setItem("jwt", response.data.jwt)

      toast({
        title: "Success",
        description: "Successfully signed in",
      })
      navigate("/")
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.response?.data?.message || "Invalid credentials",
      })
      console.error("Sign-in failed:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword)
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-zinc-900/20">
      <Card className="w-full max-w-md border-zinc-800 bg-zinc-950 shadow-xl">
        <CardHeader className="space-y-1">
          <CardTitle className="md:text-3xl text-2xl text-center font-bold tracking-tight text-zinc-100">Welcome Back</CardTitle>
          <CardDescription className="text-zinc-400 text-center pt-[10px]">
            Sign in to continue your storytelling journey
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-zinc-300">
                Email
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="Enter your email"
                value={formData.email}
                onChange={handleChange}
                className={`bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:ring-zinc-500 ${
                  errors.email ? "border-red-500" : ""
                }`}
              />
              {errors.email && <p className="text-red-500 text-sm mt-1">{errors.email}</p>}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-zinc-300">
                  Password
                </Label>
                <Button
                  variant="link"
                  className="p-0 h-auto text-xs text-zinc-400 hover:text-zinc-300"
                  onClick={() => navigate("/forgot-password")}
                >
                  Forgot password?
                </Button>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={formData.password}
                  onChange={handleChange}
                  className={`bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:ring-zinc-500 pr-10 ${
                    errors.password ? "border-red-500" : ""
                  }`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 text-zinc-400 hover:text-zinc-100"
                  onClick={togglePasswordVisibility}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  <span className="sr-only">{showPassword ? "Hide password" : "Show password"}</span>
                </Button>
              </div>
              {errors.password && <p className="text-red-500 text-sm mt-1">{errors.password}</p>}
            </div>

            <Button
              type="submit"
              className="w-full bg-zinc-50 hover:bg-zinc-200 text-zinc-950 mt-6 transition-all duration-200 transform hover:scale-[1.02]"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col items-center border-t border-zinc-800 pt-4">
          <p className="text-sm text-zinc-400">
            Don't have an account?{" "}
            <Button
              variant="link"
              className="p-0 text-zinc-300 hover:text-zinc-100"
              onClick={() => navigate("/signup")}
            >
              Sign up
            </Button>
          </p>
        </CardFooter>
      </Card>
    </div>
  )
};
