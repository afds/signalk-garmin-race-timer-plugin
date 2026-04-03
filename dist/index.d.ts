export default function (app: any): Plugin;
interface Plugin {
    start: (props: any) => void;
    stop: () => void;
    registerWithRouter: (router: any) => void;
    id: string;
    name: string;
    description: string;
    schema: any;
}
export {};
