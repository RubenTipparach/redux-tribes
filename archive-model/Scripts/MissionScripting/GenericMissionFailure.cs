using UnityEngine;
using UnityEngine.Events;

public class GenericMissionFailure : MonoBehaviour
{
    public UnityAction onCheckEvent;
    
    public virtual string GenerateMissionText(){
        return "[UNDEFINED!!!]";
    }
    
    public virtual bool CheckMissionFailed(){
        return false;
    }
    
}