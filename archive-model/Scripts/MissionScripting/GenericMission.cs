using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;

public class GenericMission : MonoBehaviour
{
    public UnityEvent onCheckEvent;
    public UnityEvent onSuccessEvent;
    public UnityEvent onFailedEvent;

    public int FullMissionAward = 250;
    
    public virtual void InitializeOnAwake()
    {
        
    }

    public virtual string GenerateMissionText()
    {
        return "[UNDEFINED!!!]";
    }
    
    public virtual bool CheckMissionGoald(){
        return false;
    }

    bool invokedSuccess = false;
    public void InvokeSuccessOnce(){
        if(!invokedSuccess)
        {
            onSuccessEvent!.Invoke();
        }

        Debug.Log("Loggin mission goal completed " + gameObject.name);
        invokedSuccess = true;
    }
}

