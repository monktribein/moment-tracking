import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { RequestDetail } from "../../eco/RequestDetail";
import { useViewer } from "../../eco/viewer";
import { Button, PageHeader } from "../../components/ui";

export default function PurchaseRequestDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const viewer = useViewer();
  return (
    <>
      <PageHeader title="Purchase request" actions={<Button icon={<ArrowLeft size={16} />} onClick={() => navigate(-1)}>Back</Button>} />
      <RequestDetail id={id} viewer={viewer} />
    </>
  );
}
