import { useNavigate } from "react-router-dom";
import { Button } from "@packages/ui";
import { ArrowLeft } from "lucide-react";

const BackButton = () => {
  const navigate = useNavigate();

  return (
    <Button
      onClick={() => navigate(-1)}
      variant="outline"
      className="flex items-center text-black/70 text-base hover:text-black transition-all px-2"
    >
      <ArrowLeft className="w-5 h-5" />
      Back
    </Button>
  );
};

export default BackButton;
